import { useEffect, useRef } from "react";
import SerialPort from "serialport";
import Readline from "@serialport/parser-readline";

export function useInterval(callback, delay) {
  const savedCallback = useRef();

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    const handler = (...args) => savedCallback.current(...args);

    if (delay !== null) {
      const id = setInterval(handler, delay);
      return () => clearInterval(id);
    }
  }, [delay]);
}

export function portCouldBePickupWinder(port) {
  return port && port.manufacturer && port.manufacturer.includes("Arduino");
}

export function openConnection(portPath) {
  return new Promise((resolve, reject) => {
    const port = new SerialPort(portPath, {
      autoOpen: false,
      baudRate: 115200,
    });
    const parser = port.pipe(new Readline());
    // Resolve promise after receiving ready message through listener,
    // then remove listener
    function readyListener(s) {
      // Use endsWith in case there's already data in buffer
      if (s.endsWith("READY0")) {
        resolve({ port, parser });
        parser.removeListener("data", readyListener);
      }
    }
    parser.on("data", readyListener);
    port.open((errMaybe) => {
      if (errMaybe) {
        reject(errMaybe);
      }
    });
  });
}
