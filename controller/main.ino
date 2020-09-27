#include <ArduinoQueue.h>
#include <AccelStepper.h>

// TODO
// - Confirm/fail messages for all SET/reset commands
// - Potentially use threader runSpeed/setSpeed instead of run/setMaxSpeed

#define version 1

#define winderEnablePin 16
#define winderStepPin 9
#define winderDirPin 12
#define threaderStepPin 13
#define threaderDirPin 14
#define limitSwitchPin 8

#define serialSpeed 115200
#define maxCommandLength 40

#define winderStepsPerRevolution 200
#define winderAcceleration 500
#define winderMaxAllowedSpeed 1200

#define threaderStepsPerMillimeter 80
#define threaderAcceleration 3000
#define threaderMaxSpeed 300
#define threaderTravel 130
#define threaderBackOff 15

// Enums
typedef enum {
  NONE,
  PING,
  START,
  STOP,
  SET_TARGET_SPEED,
  SET_TARGET_WINDS,
  RESET_WINDS,
  SET_WINDER_DIRECTION_CW,
  SET_WINDER_DIRECTION_CCW,
  SET_WINDS_PER_LAYER,
  SET_BOBBIN_HEIGHT,
  SET_THREADER_LEFT_LIMIT,
  JOG_THREADER_RIGHT,
  JOG_THREADER_LEFT,
  HOME_THREADER
} command;
typedef enum { LEFT, RIGHT } direction;

// Global variables
ArduinoQueue<char> printOutQueue(100);
int currentInputValue = 0;
direction winderDirection = RIGHT; // RIGHT = CW, LEFT = CCW
boolean winderEnabled = false;
unsigned int winds = 0;
unsigned int targetWinds = 0;
unsigned int windsPerLayer = 0;
unsigned int bobbinHeight = 0;
unsigned long threaderLeftLimit = 0;
boolean homed = false;

AccelStepper winder(1, winderStepPin, winderDirPin);
AccelStepper threader(1, threaderStepPin, threaderDirPin);

boolean isReset() {
  return winds == 0 && winder.currentPosition() == 0 && !winder.isRunning();
}

boolean hasParams() {
  return windsPerLayer > 0 && bobbinHeight > 0 && targetWinds > 0 && threaderLeftLimit > 0;
}

boolean isHomed() {
  return homed == true;
}

void qPrint(String str) {
  for (unsigned int i = 0; i < str.length(); i++) {
    printOutQueue.enqueue(str[i]);
  }
}

void message(String type, unsigned long outputValue = 0, boolean immediate = false) {
  String msg = type + outputValue + "\n";
  if (immediate) {
    Serial.print(msg);
  } else {
    qPrint(msg);
  }
}

void pong() {
  message("PONG");
}

// Home threader (blocking). Moves to the left until it hits the limit switch, then it zeroes out.
void homeThreader() {
  boolean success = true;
  threader.move(-1 * threaderTravel * threaderStepsPerMillimeter); // move at most travel
  while (digitalRead(limitSwitchPin) == LOW) {
    if (!threader.run()) {
      success = false;
      break;
    }
  }
  if (success) {
    // Zero out
    threader.setCurrentPosition(0);
    // Mark homed
    homed = true;
    // Back off
    threader.move(threaderBackOff * threaderStepsPerMillimeter);
    threader.runToPosition();
    // Message
    message("HOMED");
  } else {
    homed = false;
    message("HOMING_FAILURE");
  }
}

unsigned long windsToSteps(unsigned int winds) {
  return (long)winds * winderStepsPerRevolution;
}

float rpmToStepsPerSecond(unsigned int rpm) {
  return (float)rpm * winderStepsPerRevolution / 60;
}

unsigned int stepsPerSecondToRpm(float sss) {
  return sss * 60 / winderStepsPerRevolution; // (floor)
}

// Derive threader step position from winder step position
unsigned long deriveThreaderPosition() {
  unsigned long winderDistance = abs(winder.currentPosition());
  unsigned long winderStepsPerLayer = winderStepsPerRevolution * windsPerLayer;
  unsigned long winderStepsFromLayerStart = winderDistance % winderStepsPerLayer;

  unsigned long threaderStepsPerLayer = threaderStepsPerMillimeter * bobbinHeight;
  unsigned long threaderStepsFromLayerStart = threaderStepsPerLayer * winderStepsFromLayerStart / winderStepsPerLayer; // (floor)

  unsigned int layer = winderDistance / winderStepsPerLayer; // (floor)

  if (layer % 2 == 0) {
    // Even (left to right)
    return threaderLeftLimit + threaderStepsFromLayerStart;
  } else {
    // Odd (right to left)
    return threaderLeftLimit + threaderStepsPerLayer - threaderStepsFromLayerStart;
  }
}

void start() {
  // Ensure threader is in correct [starting] position (blocks)
  threader.moveTo(deriveThreaderPosition());
  threader.runToPosition();

  int directionMultiplier = winderDirection == RIGHT ? 1 : -1;
  winder.moveTo(directionMultiplier * windsToSteps(targetWinds));
}

void executeCommand(command cmd) {
  switch (cmd) {
    case PING:
      pong();
      break;
    case START:
      if (isHomed() && hasParams()) {
        start();
      }
      break;
    case STOP:
      winder.stop();
      break;
    case SET_TARGET_SPEED:
      if (currentInputValue <= winderMaxAllowedSpeed) {
        winder.setMaxSpeed(rpmToStepsPerSecond(currentInputValue));
      }
      break;
    case SET_TARGET_WINDS:
      // Ensure new target less than current winds
      if (currentInputValue > winds) {
        targetWinds = currentInputValue;
      }
      break;
    case RESET_WINDS:
      if (!winder.isRunning()) {
        winds = 0;
        winder.setCurrentPosition(0);
      }
      break;
    case SET_WINDER_DIRECTION_CW:
      if (isReset()) {
        winderDirection = RIGHT;
      }
      break;
    case SET_WINDER_DIRECTION_CCW:
      if (isReset()) {
        winderDirection = LEFT;
      }
      break;
    case SET_WINDS_PER_LAYER:
      if (isReset()) {
        windsPerLayer = currentInputValue;
      }
      break;
    case SET_BOBBIN_HEIGHT:
      if (isReset()) {
        bobbinHeight = currentInputValue;
      }
      break;
    case SET_THREADER_LEFT_LIMIT:
      if (isReset() && isHomed()) {
        threaderLeftLimit = threader.currentPosition();
      }
      break;
    case JOG_THREADER_RIGHT:
      if (isReset() && isHomed()) {
        threader.move(threaderStepsPerMillimeter * currentInputValue);
        threader.runToPosition();
        message("JOG_DONE");
      }
      break;
    case JOG_THREADER_LEFT:
      if (isReset() && isHomed()) {
        threader.move(-1 * threaderStepsPerMillimeter * currentInputValue);
        threader.runToPosition();
        message("JOG_DONE");
      }
      break;
    case HOME_THREADER:
      if (isReset()) {
        homeThreader();
      }
      break;
    case NONE:
      message("UNRECOGNIZED");
      break;
  }

  currentInputValue = 0;
}

command parseCommand(String cmdString) {
  if (cmdString == "P") return PING;
  if (cmdString == "START") return START;
  if (cmdString == "S") return STOP;
  if (cmdString == "T") return SET_TARGET_SPEED;
  if (cmdString == "SET_TARGET_WINDS") return SET_TARGET_WINDS;
  if (cmdString == "RESET_WINDS") return RESET_WINDS;
  if (cmdString == "SET_WINDER_DIRECTION_CW") return SET_WINDER_DIRECTION_CW;
  if (cmdString == "SET_WINDER_DIRECTION_CCW") return SET_WINDER_DIRECTION_CCW;
  if (cmdString == "SET_WINDS_PER_LAYER") return SET_WINDS_PER_LAYER;
  if (cmdString == "SET_BOBBIN_HEIGHT") return SET_BOBBIN_HEIGHT;
  if (cmdString == "SET_THREADER_LEFT_LIMIT") return SET_THREADER_LEFT_LIMIT;
  if (cmdString == "JOG_THREADER_RIGHT") return JOG_THREADER_RIGHT;
  if (cmdString == "JOG_THREADER_LEFT") return JOG_THREADER_LEFT;
  if (cmdString == "HOME_THREADER") return HOME_THREADER;
  return NONE;
}

void processIncomingByte(const int c) {
  static char inputLine[maxCommandLength];
  static unsigned int inputPos = 0;

  if (isdigit(c)) {
    currentInputValue *= 10;
    currentInputValue += c - '0';
  } else {
    switch (c) {
      case '\n':
        inputLine[inputPos] = 0; // terminating null byte
        executeCommand(parseCommand(inputLine));
        // Reset buffer for next time
        inputPos = 0;
        break;
      case '\r':
        // Discard carriage return
        break;
      default:
        if (inputPos < (maxCommandLength - 1)) {
          inputLine[inputPos++] = c;
        }
        break;
    }
  }
}

// Sync winds with winder position. Return true if changed.
boolean updateWinds() {
  unsigned int old = winds;
  winds = abs(winder.currentPosition()) / winderStepsPerRevolution; // (floor)
  return old != winds;
}

void setup()
{
  Serial.begin(serialSpeed);

  pinMode(winderEnablePin, OUTPUT);
  pinMode(limitSwitchPin, INPUT);

  // Stepper configuration
  winder.setAcceleration(winderAcceleration);
  threader.setPinsInverted(true); // direction should be inverted due to stepper/clamp position
  threader.setAcceleration(threaderAcceleration);
  threader.setMaxSpeed(threaderMaxSpeed);

  message("READY");
  message("VERSION", version);
}

boolean wasRunning = false;

void loop()
{
  // Process serial

  if (Serial.available() > 0) {
    processIncomingByte(Serial.read());
  }

  if (!printOutQueue.isEmpty()) {
    Serial.print(printOutQueue.dequeue());
  }

  // Step steppers

  boolean isRunning = winder.isRunning();

  if (isRunning != wasRunning) {
    // Message started / stopped
    message(isRunning ? "STARTED" : "STOPPED");
  }

  if (isRunning != winderEnabled) {
    digitalWrite(winderEnablePin, isRunning ? HIGH : LOW);
    winderEnabled = isRunning;
  }

  winder.run();

  if (isRunning) {
    // Sync wind counter
    if (updateWinds()) {
      // Updated
      message("W", winds);
      // Also send actual speed
      message("A", stepsPerSecondToRpm(winder.speed()));
    }

    // Sync threader position with winder position
    threader.moveTo(deriveThreaderPosition());
    threader.run();
  }

  wasRunning = isRunning;
}
