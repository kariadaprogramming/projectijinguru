# ESP32 Wiring Diagram - RFID Permission System

## Components Required
- ESP32 Development Board
- PN532 NFC RFID Module (I2C)
- LCD 16x2 with I2C Adapter (PCF8574)
- Active Buzzer
- Push Button x2 (Reset & Config)
- Jumper Wires
- Breadboard (optional)
- Power Supply (5V for ESP32)

## Pin Connections

### ESP32 to PN532 NFC RFID Module (I2C)
```
ESP32 Pin    →    PN532 Pin
────────────────────────────
GPIO 21      →    SDA (I2C Data)
GPIO 22      →    SCL (I2C Clock)
3.3V         →    VCC
GND          →    GND
```

**Note:** PN532 module uses I2C communication (4 pins only: SDA, SCL, VCC, GND).
**Important:** PN532 can operate at 3.3V or 5V. Check your module specifications.

### ESP32 to LCD 16x2 (I2C)
```
ESP32 Pin    →    LCD I2C Adapter
────────────────────────────
GPIO 21      →    SDA (Same as PN532)
GPIO 22      →    SCL (Same as PN532)
5V           →    VCC
GND          →    GND
```

**Note:** Most I2C LCD adapters use address 0x27 or 0x3F. Check your adapter and update the code if needed.
**Important:** LCD I2C shares the same I2C bus with PN532 (GPIO 21 & 22). Both devices will use the same I2C pins.
**Library:** Install "LiquidCrystal_I2C" by Frank de Brabander from Library Manager.

### ESP32 to Active Buzzer
```
ESP32 Pin    →    Buzzer
────────────────────────────
GPIO 25      →    Positive (+)
GND          →    Negative (-)
```

**Note:** Active buzzer has built-in oscillator, just apply power to make sound. Passive buzzer requires PWM signal.

### ESP32 to Push Buttons
```
ESP32 Pin    →    Button
────────────────────────────
GPIO 26      →    Reset Button (to GND)
GPIO 27      →    Config Button (to GND)
GND          →    Other side of buttons
```

**Note:** Buttons use internal pull-up resistors (INPUT_PULLUP). Connect to GND when pressed.

## Complete Wiring Table

| Component | Pin | ESP32 GPIO | Notes |
|-----------|-----|------------|-------|
| **PN532 NFC Module (I2C)** |
| | SDA | GPIO 21 | I2C Data |
| | SCL | GPIO 22 | I2C Clock |
| | VCC | 3.3V/5V | Power (check module specs) |
| | GND | GND | Ground |
| **LCD I2C** |
| | SDA | GPIO 21 | Same as PN532 (shared I2C bus) |
| | SCL | GPIO 22 | Same as PN532 (shared I2C bus) |
| | VCC | 5V | Power |
| | GND | GND | Ground |
| **Buzzer** |
| | + | GPIO 25 | Positive |
| | - | GND | Negative |
| **Reset Button** |
| | Pin 1 | GPIO 26 | Input (Pull-up) |
| | Pin 2 | GND | Ground |
| **Config Button** |
| | Pin 1 | GPIO 27 | Input (Pull-up) |
| | Pin 2 | GND | Ground |

## I2C Bus Configuration

**PN532 NFC Module:**
- Uses I2C bus (Wire) on GPIO 21 (SDA) and GPIO 22 (SCL)
- I2C address: 0x24 (default)

**LCD I2C:**
- Uses same I2C bus (Wire) on GPIO 21 (SDA) and GPIO 22 (SCL)
- I2C address: 0x27 or 0x3F (check your LCD module)
- Uses LiquidCrystal_I2C library

This configuration shares I2C bus between PN532 and LCD because they have different I2C addresses.

## Visual Diagram (ASCII)

```
                    ┌─────────────────┐
                    │     ESP32       │
                    │                 │
         3.3V ──────│ 3V3            │
                    │                 │
         GND ───────│ GND            │
                    │                 │
                    │ GPIO 21 ───────┼──→ PN532 SDA/LCD SDA
                    │                 │
                    │ GPIO 22 ───────┼──→ PN532 SCL/LCD SCL
                    │                 │
                    │ GPIO 25 ───────┼──→ Buzzer (+)
                    │                 │
                    │ GPIO 26 ───────┼──→ Reset Button
                    │                 │
                    │ GPIO 27 ───────┼──→ Config Button
                    └─────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   ┌────▼────┐       ┌────▼────┐       ┌────▼────┐
   │  PN532  │       │   LCD   │       │ Buzzer  │
   │  NFC    │       │  16x2   │       │         │
   └────┬────┘       └────┬────┘       └────┬────┘
        │                  │                  │
        │                  │                  │
   ┌────▼────┐       ┌────▼────┐       ┌────▼────┐
   │ Buttons │       │         │       │         │
   │ (x2)    │       │         │       │         │
   └─────────┘       └─────────┘       └─────────┘
```

## Library Requirements

Install the following libraries in Arduino IDE:
1. **Adafruit PN532 Library** by Adafruit
   - Library Manager: Search for "Adafruit PN532"
   - Or install from: https://github.com/adafruit/Adafruit-PN532

2. **LiquidCrystal I2C Library** by Frank de Brabander
   - Library Manager: Search for "LiquidCrystal I2C"

3. **WiFiClientSecure** (Built-in with ESP32 board package)
4. **PubSubClient** by Nick O'Leary
   - Library Manager: Search for "PubSubClient"

## Installation Instructions

1. Open Arduino IDE
2. Go to Sketch → Include Library → Manage Libraries
3. Search and install the libraries listed above
4. Select ESP32 Dev Module in Tools → Board
5. Upload the code to your ESP32

## Power Requirements
- ESP32: 5V via USB or 3.3V via regulator
- PN532: 3.3V or 5V (check module specifications)
- LCD I2C: 3.3V or 5V
- Buzzer: 3.3V or 5V

## Testing Steps
1. Connect all components according to the diagram
2. Upload the Arduino code to ESP32
3. Open Serial Monitor (115200 baud)
4. Check for initialization messages
5. Test RFID card scanning
6. Verify LCD display
7. Test buzzer sounds
8. Test push buttons (Reset & Config)

## Troubleshooting
- **RFID not detected**: Check 3.3V power, verify SPI connections
- **LCD not displaying**: Check I2C address (0x27 or 0x3F), verify SDA/SCL connections
- **Buzzer not working**: Check GPIO pin, verify polarity
- **Buttons not responding**: Check pull-up configuration, verify GND connection
- **WiFi not connecting**: Verify SSID and password in code
- **MQTT not connecting**: Check broker IP, verify network connectivity

## Safety Notes
- Always double-check connections before powering on
- Use appropriate voltage levels (3.3V for RFID)
- Ensure proper grounding
- Use current-limiting resistors for LEDs if added
- Keep wires organized to avoid short circuits
