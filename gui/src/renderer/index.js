import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom";
import create from "zustand";
import shallow from "zustand/shallow";
import SerialPort from "serialport";

import "./styles.css";

// TODO jogging status (disable)
// TODO allow float, or long / 1000
// TODO targetSpeed < 1200, else?

import { portCouldBePickupWinder, useInterval, openConnection } from "./utils";

const DIRECTION_CW = "CW";
const DIRECTION_CCW = "CCW";

const useStore = create((set) => ({
  // Connnection
  connection: null,
  availablePorts: [],

  // Status
  homed: false,
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
  jogDistance: 0, // client only

  setAvailablePorts: (availablePorts) => set(() => ({ availablePorts })),
  setWinderDirection: (winderDirection) => set(() => ({ winderDirection })),
  setTargetSpeed: (targetSpeed) => set(() => ({ targetSpeed })),
  setTargetWinds: (targetWinds) => set(() => ({ targetWinds })),
  setWindsPerLayer: (windsPerLayer) => set(() => ({ windsPerLayer })),
  setBobbinHeight: (bobbinHeight) => set(() => ({ bobbinHeight })),
  setJogDistance: (jogDistance) => set(() => ({ jogDistance })),
}));

function handleMessage(message) {
  const matchValue = message.match(/\d/);
  const matchValueIndex = matchValue && matchValue.index;
  const command = matchValueIndex
    ? message.substr(0, matchValueIndex)
    : message;
  const valueMaybe = matchValueIndex ? message.substr(matchValueIndex) : null;

  switch (command) {
    case "READY":
      console.log("ready");
      // noop
      break;
    case "VERSION":
      console.log("version", valueMaybe);
      // noop
      break;
    case "PONG":
      console.log("pong received");
      // noop
      break;
    case "HOMED":
      useStore.setState({ homed: true });
      break;
    case "HOMING_FAILURE":
      useStore.setState({ homed: false });
      alert("Homing failed");
      break;
    case "WINDS_RESET":
      useStore.setState({ winds: 0 });
      break;
    case "THREADER_LEFT_LIMIT":
      useStore.setState({ threaderLeftLimit: parseFloat(valueMaybe) });
      break;
    case "JOG_DONE":
      console.log("jog done");
      // noop
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
      console.log(command);
      throw new Error("Unrecognized message from controller");
  }
}

function writeCommand(command, valueMaybe = null) {
  const { connection } = useStore.getState();
  if (connection) {
    connection.port.write(`${command}${valueMaybe || ""}\n`); // no callback
  } else {
    throw new Error("Tried to write out command without connection");
  }
}

function syncParameter(parameter, commandOrCommandValueFn) {
  return useStore.subscribe(
    (v) =>
      typeof commandOrCommandValueFn === "function"
        ? writeCommand(...commandOrCommandValueFn(v))
        : writeCommand(commandOrCommandValueFn, v),
    (state) => state[parameter]
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

// TODO reset homed, running, winds, speed, threaderLeftLimit
function disconnect() {
  const connection = useStore.getState().connection;
  if (connection && connection.port && connection.port.isOpen) {
    connection.port.close(); // NOTE didn't supply callback
  }
  if (connection) {
    useStore.setState({ connection: null });
    alert("Disconnected");
  }
}

// TODO disconnect if received another READY0 (reset button pressed)

function connect(portPath) {
  openConnection(portPath)
    .then((connection) => {
      connection.port.on("close", () => disconnect()); // possibly already called
      connection.parser.on("data", handleMessage);
      useStore.setState({ connection });
      // TODO update controller with all parameters
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
  allowWhenHasWinds = false,
  ...restProps
}) {
  const running = useStore((store) => store.running);
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
        (!allowWhenRunning && running) || (!allowWhenHasWinds && hasWinds)
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
    !store.running &&
    store.homed &&
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
  const running = useStore((store) => store.running);
  return (
    <button disabled={!running} onClick={() => writeCommand("S")}>
      Stop
    </button>
  );
}

function ResetWindsButton() {
  const running = useStore((store) => store.running);
  return (
    <button disabled={running} onClick={() => writeCommand("RESET_WINDS")}>
      Reset Wind Counter
    </button>
  );
}

function BasicControlButton(props) {
  const ok = useStore((store) => store.connection && !store.running);
  return <button disabled={!ok} {...props} />;
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
          allowWhenRunning
          allowWhenHasWinds
        />
      </div>
      <div>
        <label htmlFor="winder-direction">Winder Direction</label>
        <WinderDirection id="winder-direction" />
      </div>
      <StartButton />
      <StopButton />
      <ResetWindsButton />
      <h3>Threader</h3>
      <BasicControlButton onClick={() => writeCommand("HOME_THREADER")}>
        Home
      </BasicControlButton>
      <BasicControlButton
        onClick={() => writeCommand("SET_THREADER_LEFT_LIMIT")}
      >
        Set Threader Left Limit
      </BasicControlButton>

      <BasicControlButton
        onClick={() => writeCommand("JOG_THREADER_TO_LEFT_LIMIT")}
      >
        Jog to Left Limit
      </BasicControlButton>
      {/* TODO */}
      <BasicControlButton>Jog Left</BasicControlButton>
      <BasicControlButton>Jog Right</BasicControlButton>
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
