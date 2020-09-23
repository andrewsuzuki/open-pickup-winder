# GUI

## UI

Status
- Online?
- Target winds
- Winds completed
- Direction
- Target speed
- Actual speed
- Threader position
- Threader left limit
- Bobbin Height (or threader right limit)
- Winds per layer

Actions
- Connect
- Start
- Stop
- Pause
- Set winder direction CW/CCW
- Set target speed [#]
- Set target winds [#]
- Set winds per layer [#]
    - Wire diameter => winds per layer
- Set bobbin height [#]
- Home threader
- Set threader left limit (at current position)
- Jog threader left
- Jog threader right

### User Workflow

1. User plugs in machine
2. User clicks Connect (with choice from available serial ports)
3. User sets up machine for new pickup (attaches bobbin, puts wire in threader)
4. User clicks Home Threader
    - Status is now homed
5. User jogs threader to left limit position
6. User clicks "Set threader left limit"
7. User sets bobbin height
8. User sets winds per layer
9. User sets direction (if needed)
10. User sets target speed
11. User clicks Start
12. [Controller winds pickup and sends status updates]
13. User removes pickup from winder
14. User clicks Reset (if winding another)
15. User repeats steps [4/11]-15
