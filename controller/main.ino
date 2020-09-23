#include <ArduinoQueue.h>

// TODO
// - Test queue prints
// - High speed limit
// - Consider having a third winder speed variable that counts steps per second.
//   Currently, there's a lot of math going on to convert between RPM and steps per second,
//   though perhaps the effect is trivial.
// - set target winds / reset
// - planned deceleration (before target winds)
// - threader stuff
// - enable pin
// - winder direction (note: should be stopped and winds = 0 before reset)
// - reset wind counter

// Define pins
const unsigned int winderDirPin = 12;
const unsigned int winderStepPin = 11;

// Constants
const unsigned long serialSpeed = 115200; // bps
const unsigned int winderStepsPerRevolution = 200;
const unsigned int winderAcceleration = 2000; // steps/s^2
const unsigned int winderDeceleration = 2500; // steps/s^2
const unsigned int minWinderSpeed = 100; // rpm (also starting speed)
const unsigned int threaderStepsPerMillimeter = 7;
//
typedef enum { NONE, SET_TARGET_SPEED, STOP } commands;

// Global variables
ArduinoQueue<char> printOutQueue(50);
commands currentCommand = NONE;
int currentInputValue = 0;
unsigned long winds = 0; // number of winds (winder revolutions since last reset)
unsigned int winderPosition = 0; // # step, up to winderStepsPerRevolution (exclusive)
unsigned long winderLastStepTime = 0; // winder: time of last step
float winderTargetSpeed = 0; // winder: target rpm
float winderActualSpeed = 0; // winder: actual/current rpm
unsigned long winderActualStepInterval = 0; // winder: actual/current interval between steps in micros (derived from winderActualSpeed)
unsigned int threaderPosition = 0;
unsigned int threaderTargetPosition = 0;
unsigned int threaderDirection = 0;

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

void completeCommand()
{
  switch (currentCommand) {
    case SET_TARGET_SPEED:
      setWinderTargetSpeed(currentInputValue);
      break;
    case STOP:
      setWinderTargetSpeed(0);
      break;
  }

  currentCommand = NONE;
  currentInputValue = 0;
}

void processIncomingByte(const byte c) {
  if (isdigit(c)) {
    currentInputValue *= 10;
    currentInputValue += c - '0';
  } else {
    // Set the new state, if we recognize it
    switch (c) {
      case 'T':
        currentCommand = SET_TARGET_SPEED;
        break;
      case 'S':
        currentCommand = STOP;
        break;
      default:
        completeCommand();
        break;
    }
  }
}

void setWinderTargetSpeed(float speed) {
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

  // Declare pins as outputs
  pinMode(winderDirPin, OUTPUT);
  pinMode(winderStepPin, OUTPUT);

  qPrint("ready\n");
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
