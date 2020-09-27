import React, { useEffect } from "react";
import ReactDOM from "react-dom";
import create from "zustand";
import SerialPort from "serialport";

import { portCouldBePickupWinder, useInterval } from "./utils";

import "./styles.css";

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

  setAvailablePorts: (availablePorts) => set(() => ({ availablePorts })),
}));

function refreshAvailablePorts() {
  SerialPort.list()
    .then((ports) => ports.filter(portCouldBePickupWinder))
    .catch(() => [])
    .then(useStore.getState().setAvailablePorts);
}

function ConnectPage() {
  const availablePorts = useStore((state) => state.availablePorts);

  useEffect(refreshAvailablePorts, []);
  useInterval(refreshAvailablePorts, 3000);

  return (
    <div>
      <h2>Connect</h2>
      {availablePorts.length === 0 ? (
        <p>No pickup winder found.</p>
      ) : (
        <>
          <select>
            {availablePorts.map((ap) => (
              <option key={ap.path}>{ap.path}</option>
            ))}
          </select>
          <button onClick={() => console.log("TODO connect...")}>
            Connect
          </button>
        </>
      )}
    </div>
  );
}

function ControlPage() {
  return (
    <div>
      <input onBlur={() => console.log("blur")} />
    </div>
  );
}

function Root() {
  const connection = useStore((state) => state.connection);

  return (
    <div>
      <h1>Open Pickup Winder</h1>
      {connection ? <ControlPage /> : <ConnectPage />}
    </div>
  );
}

ReactDOM.render(<Root />, document.getElementById("app"));
