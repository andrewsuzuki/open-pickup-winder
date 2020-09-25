#include <ArduinoQueue.h>
#include <AccelStepper.h>

// TODO
// - Relay status / messages back

#define winderEnablePin 16
#define winderStepPin 9
#define winderDirPin 12
#define threaderStepPin 13
#define threaderDirPin 14
#define limitSwitchPin 15

#define serialSpeed 115200
#define maxCommandLength 40

#define winderStepsPerRevolution 200
#define winderAcceleration 2000
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
command currentCommand = NONE;
int currentInputValue = 0;
direction winderDirection = RIGHT; // RIGHT = CW, LEFT = CCW
boolean winderEnabled = false;
unsigned int winds = 0;
unsigned int targetWinds = 0;
unsigned int windsPerLayer = 0;
unsigned int bobbinHeight = 0;
unsigned int threaderLeftLimit = 0;
boolean homed = false;

AccelStepper winder(1, winderStepPin, winderDirPin);
AccelStepper threader(1, threaderStepPin, threaderDirPin);

boolean isReset() {
  return winds == 0 && winder.currentPosition() == 0 && !winder.isRunning();
}

boolean isHomed() {
  return homed == true;
}

void qPrint(const char* str) {
  for (; *str != '\0'; str++) {
    printOutQueue.enqueue(*str);
  }
}

void pong() {
  qPrint("PONG\n");
}

// Home threader (blocking). Moves to the left until it hits the limit switch, then it zeroes out.
void homeThreader() {
  threader.move(-1 * threaderTravel * threaderStepsPerMillimeter); // move at most travel
  while (digitalRead(limitSwitchPin) == LOW) {
    if (!threader.run()) {
      break;
    }
  }
  // Zero out
  threader.setCurrentPosition(0);
  // Back off
  threader.move(threaderBackOff * threaderStepsPerMillimeter);
  // Mark homed
  homed = true;
}

unsigned int windsToSteps(unsigned int winds) {
  return winds * winderStepsPerRevolution;
}

float rpmToStepsPerSecond(unsigned int rpm) {
  return windsToSteps(rpm) / 60.0;
}

// Derive threader step position from winder step position
unsigned int deriveThreaderPosition() {
  unsigned int winderDistance = abs(winder.currentPosition());
  unsigned int winderStepsPerLayer = winderStepsPerRevolution * windsPerLayer;
  unsigned int winderStepsFromLayerStart = winderDistance % winderStepsPerLayer;

  unsigned int threaderStepsPerLayer = threaderStepsPerMillimeter * bobbinHeight;
  unsigned int threaderStepsFromLayerStart = threaderStepsPerLayer * winderStepsFromLayerStart / winderStepsPerLayer; // (floor)

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
  while (true) {
    if (!threader.run()) {
      break;
    }
  }

  int directionMultiplier = winderDirection == RIGHT ? 1 : -1;
  winder.moveTo(directionMultiplier * windsToSteps(targetWinds));
}

void executeCommand(command cmd) {
  switch (currentCommand) {
    case PING:
      pong();
      break;
    case START:
      if (isHomed()) {
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
      winds = 0;
      winder.setCurrentPosition(0);
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
      }
      break;
    case JOG_THREADER_LEFT:
      if (isReset() && isHomed()) {
        threader.move(-1 * threaderStepsPerMillimeter * currentInputValue);
      }
      break;
    case HOME_THREADER:
      if (isReset()) {
        homeThreader();
      }
      break;
  }

  currentCommand = NONE;
  currentInputValue = 0;
}

command parseCommand(const char* cmdString) {
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

void processIncomingByte(const byte c) {
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

// Sync winds with winder position. Print new count if changed.
void updateWinds() {
  unsigned int old = winds;
  winds = abs(winder.currentPosition()) / winderStepsPerRevolution; // (floor)
  if (old != winds) {
    qPrint("W" + winds);
  }
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
}

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

  if (isRunning != winderEnabled) {
    digitalWrite(winderEnablePin, isRunning ? HIGH : LOW);
    winderEnabled = isRunning;
  }

  winder.run();

  if (isRunning) {
    // Sync wind counter
    updateWinds();

    // Sync threader position with winder position
    threader.moveTo(deriveThreaderPosition());
    threader.run();
  }
}
