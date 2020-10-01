import React, { useEffect } from "react";
import ReactDOM from "react-dom";
import create from "zustand";
import shallow from "zustand/shallow";
import SerialPort from "serialport";
import classNames from "classnames";
import { useForm, FormProvider, useFormContext } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers";
import * as yup from "yup";
import get from "lodash.get";

import "./styles.scss";

// TODO threader position readout

import { portCouldBePickupWinder, useInterval, openConnection } from "./utils";

const DIRECTION_CW = "CW";
const DIRECTION_CCW = "CCW";
const UINT_MAX = 65535;
const BOBBIN_HEIGHT_MAX = 130;
const TARGET_SPEED_MAX = 1200;

const useStore = create((set) => ({
  // Connnection
  connection: null,
  availablePorts: [],

  // Status
  connecting: false,
  homed: false,
  homing: false,
  jogging: false,
  running: false,
  winds: 0,
  speed: 0,
  threaderLeftLimit: 0,

  // Parameters
  winderDirection: DIRECTION_CW,
  targetSpeed: null,
  targetWinds: null,
  windsPerLayer: null,
  bobbinHeight: null,
  jogDistance: 10, // client only

  // Setters
  setAvailablePorts: (availablePorts) => set(() => ({ availablePorts })),
  setWinderDirection: (winderDirection) => set(() => ({ winderDirection })),
  setTargetSpeed: (targetSpeed) => set(() => ({ targetSpeed })),
  setTargetWinds: (targetWinds) => set(() => ({ targetWinds })),
  setWindsPerLayer: (windsPerLayer) => set(() => ({ windsPerLayer })),
  setBobbinHeight: (bobbinHeight) => set(() => ({ bobbinHeight })),
  setJogDistance: (jogDistance) => set(() => ({ jogDistance })),
}));

const schema = yup.object().shape({
  targetSpeed: yup
    .number()
    .typeError("Must be number")
    .positive()
    .integer()
    .min(5)
    .max(TARGET_SPEED_MAX)
    .required()
    .label("Target speed"),
  targetWinds: yup
    .number()
    .typeError("Must be number")
    .positive()
    .integer()
    .min(1)
    .max(UINT_MAX)
    .required()
    .label("Target winds"),
  windsPerLayer: yup
    .number()
    .typeError("Must be number")
    .positive()
    .integer()
    .min(1)
    .max(UINT_MAX)
    .required()
    .label("Winds per layer"),
  bobbinHeight: yup
    .number()
    .typeError("Must be number")
    .positive()
    .min(1)
    .max(BOBBIN_HEIGHT_MAX)
    .required()
    .label("Bobbin height"),
  jogDistance: yup
    .number()
    .typeError("Must be number")
    .positive()
    .min(0.01)
    .max(50)
    .required()
    .label("Jog distance"),
});

// Update controller with current parameters
function postConnect() {
  const {
    winderDirection,
    targetSpeed,
    targetWinds,
    windsPerLayer,
    bobbinHeight,
  } = useStore.getState();
  writeCommand(
    winderDirection === DIRECTION_CW
      ? "SET_WINDER_DIRECTION_CW"
      : "SET_WINDER_DIRECTION_CCW"
  );
  writeCommand("T", targetSpeed || 0);
  writeCommand("SET_TARGET_WINDS", targetWinds || 0);
  writeCommand("SET_WINDS_PER_LAYER", windsPerLayer || 0);
  writeCommand("SET_BOBBIN_HEIGHT", bobbinHeight || 0);
}

function handleMessage(message) {
  const matchValue = message.match(/\d/);
  const matchValueIndex = matchValue && matchValue.index;
  const command = matchValueIndex
    ? message.substr(0, matchValueIndex)
    : message;
  const valueMaybe = matchValueIndex
    ? parseInt(message.substr(matchValueIndex), 10) / 100
    : null;

  // Handle possibly-garbage READY (data already in output buffer)
  if (command.endsWith("READY")) {
    console.log("ready");
    postConnect(); // Possibly again after initial connection
    return;
  }

  switch (command) {
    // case "READY": // handled above
    //   break;
    case "VERSION":
      console.log("version", valueMaybe);
      // noop
      break;
    case "PONG":
      console.log("pong received");
      // noop
      break;
    case "HOMED":
      useStore.setState({ homed: true, homing: false });
      break;
    case "HOMING_FAILURE":
      useStore.setState({ homed: false, homing: false });
      alert("Homing failed.");
      break;
    case "WINDS_RESET":
      useStore.setState({ winds: 0 });
      break;
    case "THREADER_LEFT_LIMIT":
      useStore.setState({ threaderLeftLimit: valueMaybe });
      break;
    case "JOG_DONE":
      console.log("jog done");
      useStore.setState({ jogging: false });
      break;
    case "JOGGING_FAILURE":
      useStore.setState({ jogging: false });
      alert("Jog failed.");
      break;
    case "STARTED":
      useStore.setState({ running: true });
      break;
    case "STOPPED":
      useStore.setState({ running: false });
      break;
    case "W": // (winds)
      useStore.setState({ winds: valueMaybe });
      break;
    case "A": // (actual/current speed)
      useStore.setState({ speed: valueMaybe });
      break;
    case "UNRECOGNIZED":
      throw new Error("Controller didn't recognize command");
    default:
      throw new Error(`Unrecognized message from controller: ${message}`);
  }
}

function getConnection() {
  const { connection } = useStore.getState();
  if (!connection) {
    throw new Error("No connection");
  }
  return connection;
}

function writeCommand(command, valueMaybe = null) {
  const connection = getConnection();
  connection.port.write(
    `${command}${valueMaybe ? Math.round(valueMaybe * 100) : ""}\n`
  ); // no callback
}

function home() {
  const { homing } = useStore.getState();
  if (homing) {
    throw new Error("Already homing");
  }
  useStore.setState({ homed: false, homing: true });
  writeCommand("HOME_THREADER");
}

function jog(command, sendJogDistance = true) {
  const { jogging, jogDistance } = useStore.getState();
  if (jogging) {
    throw new Error("Already jogging");
  }
  useStore.setState({ jogging: true });
  writeCommand(command, sendJogDistance ? jogDistance : null);
}

function syncParameter(parameter, commandOrCommandValueFn) {
  return useStore.subscribe(
    ([v, connection]) =>
      connection &&
      (typeof commandOrCommandValueFn === "function"
        ? writeCommand(...commandOrCommandValueFn(v))
        : writeCommand(commandOrCommandValueFn, v)),
    (state) => [state[parameter] || 0, state.connection],
    shallow
  );
}

syncParameter("winderDirection", (v) => [
  v === DIRECTION_CW ? "SET_WINDER_DIRECTION_CW" : "SET_WINDER_DIRECTION_CCW",
  null,
]);
syncParameter("targetSpeed", "T");
syncParameter("targetWinds", "SET_TARGET_WINDS");
syncParameter("windsPerLayer", "SET_WINDS_PER_LAYER");
syncParameter("bobbinHeight", "SET_BOBBIN_HEIGHT");

function disconnect() {
  const { connection } = useStore.getState();
  if (connection && connection.port && connection.port.isOpen) {
    connection.port.close(); // NOTE didn't supply callback
  }

  useStore.setState({
    // Remove connection
    connection: null,

    // Reset status state
    connecting: false,
    homed: false,
    homing: false,
    jogging: false,
    running: false,
    winds: 0,
    speed: 0,
    threaderLeftLimit: 0,
  });
}

function connect(portPath) {
  useStore.setState({ connecting: true });
  openConnection(portPath)
    .then((connection) => {
      useStore.setState({ connection, connecting: false });
      connection.port.on("close", disconnect); // possibly already called
      connection.parser.on("data", handleMessage);
      postConnect();
    })
    .catch((err) => {
      useStore.setState({ connecting: false });
      disconnect();
      alert(`Could not connect: ${err.message}`);
    });
}

function refreshAvailablePorts() {
  SerialPort.list()
    .then((ports) => ports.filter(portCouldBePickupWinder))
    .catch(() => [])
    .then(useStore.getState().setAvailablePorts);
}

function Connection() {
  const connection = useStore((state) => state.connection);
  const availablePorts = useStore((state) => state.availablePorts);
  const connecting = useStore((state) => state.connecting);

  useEffect(refreshAvailablePorts, []);
  useInterval(refreshAvailablePorts, 3000);

  const isConnected = !!connection;

  return (
    <div>
      {availablePorts.length === 0 ? (
        <p>No pickup winder found.</p>
      ) : (
        <>
          <div className="mb-3">
            <select
              id="select-port"
              disabled={isConnected}
              className="form-select d-inline-block"
              // NOTE uncontrolled
            >
              {availablePorts.map(({ path }) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          </div>
          <div className="mb-3">
            <button
              onClick={() => connect(availablePorts[0].path)}
              disabled={isConnected}
              className="btn btn-primary"
            >
              {isConnected ? (
                "Connected"
              ) : connecting ? (
                <>
                  <span
                    className="spinner-border spinner-border-sm"
                    role="status"
                    aria-hidden="true"
                    style={{ verticalAlign: "middle" }}
                  ></span>{" "}
                  Connecting...
                </>
              ) : (
                "Connect"
              )}
            </button>{" "}
            <button
              onClick={() => disconnect()}
              disabled={!isConnected}
              className="btn btn-light"
            >
              Disconnect
            </button>{" "}
            <button
              onClick={() => writeCommand("P")}
              disabled={!isConnected}
              className="btn btn-light"
            >
              Ping
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Parameter({
  getterKey,
  setterKey,
  allowWhenRunning = false,
  allowWhenHomingOrJogging = false,
  allowWhenHasWinds = false,
  className = null,
  ...restProps
}) {
  const { register, errors, watch } = useFormContext();

  const running = useStore((store) => store.running);
  const homingOrJogging = useStore((store) => store.homing || store.jogging);
  const hasWinds = useStore((store) => store.winds > 0);

  const valueFromStore = useStore((store) => store[getterKey]);
  const setStoreValue = useStore((store) => store[setterKey]);

  const value = watch(getterKey);
  const hasError = !!errors[getterKey];

  // Sync form value to store value
  // NOTE does not sync other direction (store to value)
  useEffect(() => {
    const parsed = (!hasError && parseFloat(value)) || null;
    if (parsed !== valueFromStore) {
      setStoreValue(parsed);
    }
  }, [hasError, value, valueFromStore]);

  return (
    <input
      type="text"
      {...restProps}
      ref={register}
      name={getterKey}
      defaultValue={`${valueFromStore === null ? "" : valueFromStore}`}
      className={classNames(className, hasError && "is-invalid")}
      disabled={
        (!allowWhenRunning && running) ||
        (!allowWhenHomingOrJogging && homingOrJogging) ||
        (!allowWhenHasWinds && hasWinds)
      }
    />
  );
}

function FormError({ getterKey }) {
  const { errors } = useFormContext();
  const message = get(errors, [getterKey, "message"]);
  return message ? <div className="invalid-feedback">{message}</div> : null;
}

function ParameterField({ id, label, getterKey, ...restProps }) {
  return (
    <div className="mb-3">
      <label htmlFor={id} className="form-label">
        {label}
      </label>
      <Parameter
        id={id}
        className="form-control"
        getterKey={getterKey}
        {...restProps}
      />
      <FormError getterKey={getterKey} />
    </div>
  );
}

function WinderDirection({ ...restProps }) {
  const {
    connection,
    running,
    winds,
    winderDirection,
    setWinderDirection,
  } = useStore(
    ({ connection, running, winds, winderDirection, setWinderDirection }) => ({
      connection,
      running,
      winds,
      winderDirection,
      setWinderDirection,
    }),
    shallow
  );

  return (
    <select
      {...restProps}
      disabled={!connection || running || winds > 0}
      value={winderDirection}
      onChange={(e) => setWinderDirection(e.target.value)}
    >
      {[DIRECTION_CW, DIRECTION_CCW].map((dir) => (
        <option key={dir} value={dir}>
          {dir}
        </option>
      ))}
    </select>
  );
}

function StatusPart({ storeKey, label, children }) {
  const value = useStore((store) => store[storeKey]);
  return (
    <div className="mb-2">
      <span>{label}</span>
      <div>{children(value)}</div>
    </div>
  );
}

function okToStart(store) {
  return (
    store.connection &&
    store.homed &&
    !store.homing &&
    !store.jogging &&
    !store.running &&
    store.threaderLeftLimit > 0 &&
    store.targetSpeed > 0 &&
    store.targetWinds > 0 &&
    store.windsPerLayer > 0 &&
    store.bobbinHeight > 0
  );
}

function StartButton() {
  const ok = useStore((store) => okToStart(store));
  const running = useStore((store) => store.running);
  return (
    <button
      disabled={!ok}
      onClick={() => writeCommand("START")}
      className="btn btn-success"
    >
      {running ? "Running" : "Start"}
    </button>
  );
}

function StopButton() {
  const ok = useStore(
    (store) =>
      store.connection && store.running && !store.jogging && !store.homing
  );
  return (
    <button
      disabled={!ok}
      onClick={() => writeCommand("S")}
      className="btn btn-danger"
    >
      {ok ? "Stop" : "Stopped"}
    </button>
  );
}

function BasicControlButton({
  requireHomed = false,
  requireThreaderLeftLimit = false,
  requireNoWinds = false,
  requireJogDistance = false,
  brand = "light",
  ...restProps
}) {
  const ok = useStore(
    (store) =>
      store.connection && !store.running && !store.jogging && !store.homing
  );
  const homed = useStore((store) => store.homed);
  const hasThreaderLeftLimit = useStore((store) => store.threaderLeftLimit > 0);
  const hasWinds = useStore((store) => store.winds > 0);
  const jogDistance = useStore((store) => store.jogDistance);
  return (
    <button
      disabled={
        !ok ||
        (requireHomed && !homed) ||
        (requireThreaderLeftLimit && !hasThreaderLeftLimit) ||
        (requireNoWinds && hasWinds) ||
        (requireJogDistance && !jogDistance)
      }
      className={`btn btn-${brand}`}
      {...restProps}
    />
  );
}

function StateBadge() {
  const { connection, homing, jogging, running } = useStore(
    ({ connection, homing, jogging, running }) => ({
      connection,
      homing,
      jogging,
      running,
    }),
    shallow
  );

  return homing ? (
    <span className="badge bg-primary">Homing</span>
  ) : jogging ? (
    <span className="badge bg-primary">Jogging</span>
  ) : running ? (
    <span className="badge bg-success">Running</span>
  ) : connection ? (
    <span className="badge bg-secondary">Idle</span>
  ) : (
    <span className="badge bg-light text-danger">Disconnected</span>
  );
}

function ControlPage() {
  const methods = useForm({
    mode: "all",
    resolver: yupResolver(schema),
  });

  return (
    <FormProvider {...methods}>
      <div className="row">
        <div className="col">
          <div className="py-1">
            <h2>
              Status <StateBadge />
            </h2>
            <StatusPart storeKey="winds" label="Winds">
              {(winds) => winds}
            </StatusPart>
            <StatusPart storeKey="speed" label="Speed">
              {(speed) => `${speed}rpm`}
            </StatusPart>
            <StatusPart storeKey="homed" label="Homed">
              {(homed) =>
                homed ? (
                  <span className="text-success">Yes</span>
                ) : (
                  <span className="text-danger">No</span>
                )
              }
            </StatusPart>
            <StatusPart storeKey="threaderLeftLimit" label="Start Position">
              {(threaderLeftLimit) =>
                threaderLeftLimit === 0 ? (
                  <span className="text-danger">Not set</span>
                ) : (
                  `${threaderLeftLimit}mm`
                )
              }
            </StatusPart>
          </div>
          <div className="py-1">
            <h2>Pickup</h2>
            <ParameterField
              id="target-winds"
              label="Target Winds"
              getterKey="targetWinds"
              setterKey="setTargetWinds"
            />
            <div className="row">
              <div className="col">
                <ParameterField
                  id="bobbin-height"
                  label="Bobbin Height (mm)"
                  getterKey="bobbinHeight"
                  setterKey="setBobbinHeight"
                />
              </div>
              <div className="col">
                <ParameterField
                  id="winds-per-layer"
                  label="Winds per Layer"
                  getterKey="windsPerLayer"
                  setterKey="setWindsPerLayer"
                />
              </div>
            </div>
          </div>
        </div>
        <div className="col">
          <div className="py-1">
            <h2>Connection</h2>
            <Connection />
          </div>
          <div className="py-1">
            <h2>Controls</h2>
            <div className="row">
              <div className="col">
                <ParameterField
                  id="target-speed"
                  label="Target Speed"
                  getterKey="targetSpeed"
                  setterKey="setTargetSpeed"
                  // BUG Should be able to set while running. Currently works
                  // ok when setting a higher value, but not a lower value.
                  // allowWhenRunning
                  allowWhenHasWinds
                />
              </div>
              <div className="col">
                <div className="mb-3">
                  <label htmlFor="winder-direction" className="form-label">
                    Winder Direction
                  </label>
                  <WinderDirection
                    id="winder-direction"
                    className="form-select"
                  />
                </div>
              </div>
            </div>
            <div className="mb-3">
              <StartButton /> <StopButton />{" "}
              <BasicControlButton onClick={() => writeCommand("RESET_WINDS")}>
                Reset Winds
              </BasicControlButton>
            </div>
          </div>
          <div className="py-1">
            <h3>Threader</h3>
            <div className="mb-3">
              <BasicControlButton onClick={home} requireNoWinds>
                Home
              </BasicControlButton>{" "}
              <BasicControlButton
                requireHomed
                requireNoWinds
                onClick={() => writeCommand("SET_THREADER_LEFT_LIMIT")}
              >
                Set Start Position
              </BasicControlButton>
            </div>
            <label htmlFor="jog-distance" className="form-label">
              Jog
            </label>
            <div className="input-group mb-3">
              <BasicControlButton
                requireHomed
                requireNoWinds
                requireJogDistance
                onClick={() => jog("JOG_THREADER_LEFT")}
              >
                Left
              </BasicControlButton>{" "}
              <BasicControlButton
                requireHomed
                requireNoWinds
                requireJogDistance
                onClick={() => jog("JOG_THREADER_RIGHT")}
              >
                Right
              </BasicControlButton>
              <Parameter
                id="jog-distance"
                className="form-control"
                getterKey="jogDistance"
                setterKey="setJogDistance"
              />
              <span className="input-group-text">mm</span>
            </div>
            <div className="mb-3">
              <BasicControlButton
                requireHomed
                requireThreaderLeftLimit
                requireNoWinds
                onClick={() => jog("JOG_THREADER_TO_LEFT_LIMIT", false)}
              >
                Jog to Start Position
              </BasicControlButton>
            </div>
          </div>
        </div>
      </div>
    </FormProvider>
  );
}

function Root() {
  return (
    <div>
      <nav className="navbar navbar-light bg-light">
        <div className="container-fluid">
          <span className="navbar-brand mb-0 h1">Open Pickup Winder</span>
        </div>
      </nav>
      <main>
        <section className="container py-3">
          <ControlPage />
        </section>
      </main>
    </div>
  );
}

ReactDOM.render(<Root />, document.getElementById("app"));
