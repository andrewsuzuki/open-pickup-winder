#include <ArduinoQueue.h>

// TODO
// - Test queue prints
// - Consider having a third winder speed variable that counts steps per second. Reduce float calcs.
// - Planned deceleration (before target winds)
// - Threader stuff
// - Winder enable
// - Set winder direction (note: should be stopped and winds = 0 before reset)
// - Reset wind counter

// Define pins
const unsigned int winderDirPin = 12;
const unsigned int winderStepPin = 11;
const unsigned int threaderDirPin = 14;
const unsigned int threaderStepPin = 13;
const unsigned int limitSwitchPin = 15;

// Constants
const unsigned long serialSpeed = 115200; // bps
const unsigned int maxCommandLength = 40; // bytes
const unsigned int winderStepsPerRevolution = 200;
const unsigned int winderAcceleration = 2000; // steps/s^2
const unsigned int winderDeceleration = 2500; // steps/s^2
const unsigned int minWinderSpeed = 100; // rpm (also starting speed)
const unsigned int maxWinderSpeed = 1200; // rpm
const unsigned int threaderStepsPerMillimeter = 7;
//
typedef enum {
  NONE,
  PING,
  SET_WINDER_DIRECTION_CW,
  SET_WINDER_DIRECTION_CCW,
  SET_TARGET_SPEED,
  SET_TARGET_WINDS,
  RESET_WINDS,
  SET_WINDS_PER_LAYER,
  SET_BOBBIN_HEIGHT,
  SET_THREADER_LEFT_LIMIT,
  JOG_THREADER_RIGHT,
  JOG_THREADER_LEFT
  HOME_THREADER
} command;
typedef enum { LEFT, RIGHT } direction;

// Global variables
ArduinoQueue<char> printOutQueue(50);
commands currentCommand = NONE;
int currentInputValue = 0;
direction winderDirection = RIGHT; // RIGHT = CW, LEFT = CCW
unsigned long winds = 0; // number of winds (winder revolutions since last reset)
unsigned int winderPosition = 0; // # step, up to winderStepsPerRevolution (exclusive)
unsigned long winderLastStepTime = 0; // winder: time of last step
float winderTargetSpeed = 0; // winder: target rpm
float winderActualSpeed = 0; // winder: actual/current rpm
unsigned long winderActualStepInterval = 0; // winder: actual/current interval between steps in micros (derived from winderActualSpeed)
unsigned int threaderPosition = 0;
unsigned int threaderTargetPosition = 0;
direction threaderDirection = RIGHT;
unsigned int threaderLeftLimit = 0;
unsigned int targetWinds = 0;
unsigned int windsPerLayer = 0;
unsigned int bobbinHeight = 0;

void step(int stepPin) {
  winderLastStepTime = micros();
  digitalWrite(stepPin, HIGH);
  delayMicroseconds(1);
  digitalWrite(stepPin, LOW);
}

void qPrint(const char* str) {
  for (; *str != '\0'; str++) {
    printOutQueue.enqueue(*str);
  }
}

void pong() {
  qPrint("PONG\n");
}

void jogThreader(float distance, direction dir) {
  // TODO
}

void homeThreader() {
  // TODO set direction to left
  // TODO timeout; this is kind of primitive
  while (digitalRead(limitSwitchPin) == LOW) {
    step(threaderStepPin);
    delayMicroseconds(1000); // TODO tweak
  }
  // Zero out
  threaderPosition = 0;
  // Back off
  jogThreader(10.0, RIGHT);
}

void executeCommand(command cmd) {
  switch (currentCommand) {
    case PING:
      pong();
      break;
    case SET_WINDER_DIRECTION_CW:
      winderDirection = RIGHT;
      break;
    case SET_WINDER_DIRECTION_CCW:
      winderDirection = LEFT;
      break;
    case SET_TARGET_SPEED:
      setWinderTargetSpeed(currentInputValue);
      break;
    case SET_TARGET_WINDS:
      targetWinds = currentInputValue;
      break;
    case RESET_WINDS:
      winds = 0;
      winderPosition = 0;
      break;
    case SET_WINDS_PER_LAYER:
      windsPerLayer = currentInputValue;
      break;
    case SET_BOBBIN_HEIGHT:
      bobbinHeight = currentInputValue;
      break;
    case SET_THREADER_LEFT_LIMIT:
      threaderLeftLimit = threaderPosition;
      break;
    case JOG_THREADER_RIGHT:
      jogThreader(currentInputValue, RIGHT);
      break;
    case JOG_THREADER_LEFT:
      jogThreader(currentInputValue, LEFT);
      break;
    case HOME_THREADER:
      homeThreader();
      break;
  }

  currentCommand = NONE;
  currentInputValue = 0;
}

command parseCommand(const char* cmdString) {
  if (cmdString == "P") return PING;
  if (cmdString == "SET_WINDER_DIRECTION_CW") return SET_WINDER_DIRECTION_CW;
  if (cmdString == "SET_WINDER_DIRECTION_CCW") return SET_WINDER_DIRECTION_CCW;
  if (cmdString == "S") return SET_TARGET_SPEED;
  if (cmdString == "SET_TARGET_WINDS") return SET_TARGET_WINDS;
  if (cmdString == "RESET_WINDS") return RESET_WINDS;
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

void setWinderTargetSpeed(float speed) {
  if (speed > maxWinderSpeed) {
    // Greater than max acceptable speed; do nothing
    return;
  }

  winderTargetSpeed = speed;
  recalculateWinderActualSpeed();
}

void setWinderActualSpeed(float speed) {
  winderActualSpeed = speed;

  // Derive step interval (microseconds) from speed (rpm)
  if (speed == 0) {
    winderActualStepInterval = 0;
  } else {
    winderActualStepInterval = (60 * 1000000) / (speed * winderStepsPerRevolution);
  }
}

void recalculateWinderActualSpeed() {
  if (winderTargetSpeed == winderActualSpeed) {
    return;
  }

  if (abs(winderTargetSpeed - winderActualSpeed) < 1) {
    // Handle non/near-convergent actual speed
    setWinderActualSpeed(winderTargetSpeed);
    return;
  }

  if (winderActualSpeed == 0) {
    // First step from idle;
    setWinderActualSpeed(minWinderSpeed);
  } else {
    // Already spinning; accelerate or decelerate
    float stepsPerSecond = winderActualSpeed * winderStepsPerRevolution / 60;
    int dirMultiplier = (winderTargetSpeed > winderActualSpeed) ? 1 : -1;
    unsigned int acdec = dirMultiplier == 1 ? winderAcceleration : winderDeceleration;
    float newStepsPerSecond = stepsPerSecond + dirMultiplier * abs(acdec / stepsPerSecond);
    float newWinderActualSpeed = newStepsPerSecond * 60 / winderStepsPerRevolution;
    // If less than minimum speed, bring to zero (immediate)
    setWinderActualSpeed(newWinderActualSpeed < minWinderSpeed ? 0 : newWinderActualSpeed);
  }
}

void stepWinderIfRequired() {
  unsigned long currentMicros = micros();
  if (winderActualStepInterval != 0 && currentMicros >= winderLastStepTime + winderActualStepInterval) {
    step(winderStepPin);

    // Track winder position and number of winds
    winderPosition++;
    if (winderPosition == winderStepsPerRevolution) {
      winds++;
      winderPosition = 0;
    }

    // Accelerate if required
    recalculateWinderActualSpeed();
  }
}

void setup()
{
  Serial.begin(serialSpeed);

  // Set pin modes
  pinMode(winderDirPin, OUTPUT);
  pinMode(winderStepPin, OUTPUT);
  pinMode(threaderDirPin, OUTPUT);
  pinMode(threaderStepPin, OUTPUT);
  pinMode(limitSwitchPin, INPUT);
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

  stepWinderIfRequired();
}
