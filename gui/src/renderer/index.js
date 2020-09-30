import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom";
import create from "zustand";
import shallow from "zustand/shallow";
import SerialPort from "serialport";

import "./styles.css";

// TODO allow float, or long / 1000
// TODO ensure targetSpeed < 1200, else?
// TODO CSS framework, make pretty

import { portCouldBePickupWinder, useInterval, openConnection } from "./utils";

const DIRECTION_CW = "CW";
const DIRECTION_CCW = "CCW";

const useStore = create((set) => ({
  // Connnection
  connection: null,
  availablePorts: [],

  // Status
  homed: false,
  homing: false,
  jogging: false,
  running: false,
  winds: 0,
  speed: 0,
  threaderLeftLimit: 0,

  // Parameters
  winderDirection: DIRECTION_CW,
  targetSpeed: 0,
  targetWinds: 0,
  windsPerLayer: 0,
  bobbinHeight: 0,
  jogDistance: 10, // client only

  setAvailablePorts: (availablePorts) => set(() => ({ availablePorts })),
  setWinderDirection: (winderDirection) => set(() => ({ winderDirection })),
  setTargetSpeed: (targetSpeed) => set(() => ({ targetSpeed })),
  setTargetWinds: (targetWinds) => set(() => ({ targetWinds })),
  setWindsPerLayer: (windsPerLayer) => set(() => ({ windsPerLayer })),
  setBobbinHeight: (bobbinHeight) => set(() => ({ bobbinHeight })),
  setJogDistance: (jogDistance) => set(() => ({ jogDistance })),
}));

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
  writeCommand("T", targetSpeed);
  writeCommand("SET_TARGET_WINDS", targetWinds);
  writeCommand("SET_WINDS_PER_LAYER", windsPerLayer);
  writeCommand("SET_BOBBIN_HEIGHT", bobbinHeight);
}

function handleMessage(message) {
  const matchValue = message.match(/\d/);
  const matchValueIndex = matchValue && matchValue.index;
  const command = matchValueIndex
    ? message.substr(0, matchValueIndex)
    : message;
  const valueMaybe = matchValueIndex ? message.substr(matchValueIndex) : null;

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
      alert("homing fail");
      break;
    case "WINDS_RESET":
      useStore.setState({ winds: 0 });
      break;
    case "THREADER_LEFT_LIMIT":
      useStore.setState({ threaderLeftLimit: parseFloat(valueMaybe) });
      break;
    case "JOG_DONE":
      console.log("jog done");
      useStore.setState({ jogging: false });
      break;
    case "JOGGING_FAILURE":
      console.log("jog fail");
      useStore.setState({ jogging: false });
      break;
    case "STARTED":
      useStore.setState({ running: true });
      break;
    case "STOPPED":
      useStore.setState({ running: false });
      break;
    case "W": // (winds)
      useStore.setState({ winds: parseInt(valueMaybe, 10) });
      break;
    case "A": // (actual speed)
      useStore.setState({ speed: parseInt(valueMaybe, 10) });
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
  connection.port.write(`${command}${valueMaybe || ""}\n`); // no callback
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
    (state) => [state[parameter], state.connection],
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
  if (connection) {
    useStore.setState({ connection: null });
    alert("Disconnected");
  }

  // Reset status state
  useStore.setState({
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
  openConnection(portPath)
    .then((connection) => {
      connection.port.on("close", disconnect); // possibly already called
      connection.parser.on("data", handleMessage);
      useStore.setState({ connection });
      postConnect();
    })
    .catch((err) => {
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

  useEffect(refreshAvailablePorts, []);
  useInterval(refreshAvailablePorts, 3000);

  const isConnected = !!connection;

  return (
    <div>
      {availablePorts.length === 0 ? (
        <p>No pickup winder found.</p>
      ) : (
        <>
          <label htmlFor="select-port">
            <select id="select-port" disabled={isConnected}>
              {availablePorts.map((ap) => (
                <option key={ap.path}>{ap.path}</option>
              ))}
            </select>
          </label>
          <button
            onClick={() => connect(availablePorts[0].path)}
            disabled={isConnected}
          >
            Connect
          </button>
          <button onClick={() => disconnect()} disabled={!isConnected}>
            Disconnect
          </button>
          <button onClick={() => writeCommand("P")} disabled={!isConnected}>
            Ping
          </button>
        </>
      )}
    </div>
  );
}

function coercePositiveInt(v) {
  const int = parseInt(v, 10);
  return !int || int < 0 ? 0 : int;
}

function Parameter({
  getterKey,
  setterKey,
  allowWhenRunning = false,
  allowWhenHomingOrJogging = false,
  allowWhenHasWinds = false,
  ...restProps
}) {
  const running = useStore((store) => store.running);
  const homingOrJogging = useStore((store) => store.homing || store.jogging);
  const hasWinds = useStore((store) => store.winds > 0);
  const value = useStore((store) => store[getterKey]);
  const setter = useStore((store) => store[setterKey]);

  const [temp, setTemp] = useState(`${value}`);

  useEffect(() => {
    setTemp(`${value}`);
  }, [value]);

  const onChange = (e) => {
    const v = e.target.value;
    if (v.match(/^\d+$/) || v === "") {
      setTemp(e.target.value);
    }
  };

  const onEnterOrBlur = () => setter(coercePositiveInt(temp));

  return (
    <input
      type="text"
      {...restProps}
      disabled={
        (!allowWhenRunning && running) ||
        (!allowWhenHomingOrJogging && homingOrJogging) ||
        (!allowWhenHasWinds && hasWinds)
      }
      onChange={onChange}
      onBlur={onEnterOrBlur}
      onKeyUp={(e) => e.key === "Enter" && onEnterOrBlur()}
      value={temp}
    />
  );
}

function WinderDirection({ ...restProps }) {
  const { connection, running, winderDirection, setWinderDirection } = useStore(
    ({ connection, running, winderDirection, setWinderDirection }) => ({
      connection,
      running,
      winderDirection,
      setWinderDirection,
    }),
    shallow
  );

  return (
    <select
      {...restProps}
      disabled={!(connection && !running)}
      value={winderDirection}
      onChange={(e) => setWinderDirection(e.target.value)}
    >
      <option>{DIRECTION_CW}</option>
      <option>{DIRECTION_CCW}</option>
    </select>
  );
}

function StatusPart({ storeKey, children }) {
  const value = useStore((store) => store[storeKey]);
  return <>{children(value)}</>;
}

function okToStart(store) {
  return (
    store.connection &&
    store.homed &&
    !store.homing &&
    !store.jogging &&
    !store.running &&
    store.threaderLeftLimit > 0 &&
    store.windsPerLayer > 0 &&
    store.bobbinHeight > 0 &&
    store.targetWinds > 0 &&
    store.threaderLeftLimit > 0
  );
}

function StartButton() {
  const ok = useStore((store) => okToStart(store));
  return (
    <button disabled={!ok} onClick={() => writeCommand("START")}>
      Start
    </button>
  );
}

function StopButton() {
  const ok = useStore(
    (store) =>
      store.connection && store.running && !store.jogging && !store.homing
  );
  return (
    <button disabled={!ok} onClick={() => writeCommand("S")}>
      Stop
    </button>
  );
}

function BasicControlButton({ requireHomed = false, ...restProps }) {
  const ok = useStore(
    (store) =>
      store.connection && !store.running && !store.jogging && !store.homing
  );
  const homed = useStore((store) => store.homed);
  return <button disabled={!ok || (requireHomed && !homed)} {...restProps} />;
}

function ControlPage() {
  return (
    <div>
      <h2>Status</h2>
      <StatusPart storeKey="homed">
        {(homed) => <p>Homed? {homed ? "Yes" : "No"}</p>}
      </StatusPart>
      <StatusPart storeKey="running">
        {(running) => <p>Running? {running ? "Yes" : "No"}</p>}
      </StatusPart>
      <StatusPart storeKey="winds">
        {(winds) => <p>Winds: {winds}</p>}
      </StatusPart>
      <StatusPart storeKey="speed">
        {(speed) => <p>Actual Speed: {speed}rpm</p>}
      </StatusPart>
      <StatusPart storeKey="threaderLeftLimit">
        {(threaderLeftLimit) => (
          <p>Threader Left Limit: {threaderLeftLimit}mm</p>
        )}
      </StatusPart>
      <h2>Pickup</h2>
      <div>
        <label htmlFor="target-winds">Target Winds</label>
        <Parameter
          id="target-winds"
          getterKey="targetWinds"
          setterKey="setTargetWinds"
        />
      </div>
      <div>
        <label htmlFor="bobbin-height">Bobbin Height (mm)</label>
        <Parameter
          id="bobbin-height"
          getterKey="bobbinHeight"
          setterKey="setBobbinHeight"
        />
      </div>
      <div>
        <label htmlFor="winds-per-layer">Winds per Layer</label>
        <Parameter
          id="winds-per-layer"
          getterKey="windsPerLayer"
          setterKey="setWindsPerLayer"
        />
      </div>
      <h2>Controls</h2>
      <div>
        <label htmlFor="target-speed">Target Speed</label>
        <Parameter
          id="target-speed"
          getterKey="targetSpeed"
          setterKey="setTargetSpeed"
          // BUG Should be able to set while running. Currently works
          // ok when setting a higher value, but not a lower value.
          // allowWhenRunning
          allowWhenHasWinds
        />
      </div>
      <div>
        <label htmlFor="winder-direction">Winder Direction</label>
        <WinderDirection id="winder-direction" />
      </div>
      <StartButton />
      <StopButton />
      <BasicControlButton onClick={() => writeCommand("RESET_WINDS")}>
        Reset Winds
      </BasicControlButton>
      <h3>Threader</h3>
      <BasicControlButton onClick={home}>Home</BasicControlButton>
      <BasicControlButton
        requireHomed
        onClick={() => writeCommand("SET_THREADER_LEFT_LIMIT")}
      >
        Set Threader Left Limit
      </BasicControlButton>

      <BasicControlButton
        requireHomed
        onClick={() => jog("JOG_THREADER_TO_LEFT_LIMIT", false)}
      >
        Jog to Left Limit
      </BasicControlButton>
      <BasicControlButton requireHomed onClick={() => jog("JOG_THREADER_LEFT")}>
        Jog Left
      </BasicControlButton>
      <BasicControlButton
        requireHomed
        onClick={() => jog("JOG_THREADER_RIGHT")}
      >
        Jog Right
      </BasicControlButton>
      <div>
        <label htmlFor="jog-distance">Jog Distance (mm)</label>
        <Parameter
          id="jog-distance"
          getterKey="jogDistance"
          setterKey="setJogDistance"
        />
      </div>
      <h2>Connection</h2>
      <Connection />
    </div>
  );
}

function Root() {
  return (
    <div>
      <h1>Open Pickup Winder</h1>
      <ControlPage />
    </div>
  );
}

ReactDOM.render(<Root />, document.getElementById("app"));
