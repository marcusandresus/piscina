# SPEC - Piscina PWA v1

## Pantallas (orden)
1) Home/Status
2) New Session - Water Height
3) New Session - pH
4) New Session - Chlorine
5) Results
6) pH Correction Stage 1 (apply 50%)
7) Wait (4-6 hours reminder)
8) Chlorine Correction
9) History
10) Settings

## Reglas
- Session requiere waterHeight + measured pH + measured chlorine.
- pH correction ALWAYS in two stages:
  - Stage 1 = 50% of computed total dose.
  - After wait, user re-measures before Stage 2 (Stage 2 not required in v1 UI if we keep it as “repeat process”).
- Settings persist across sessions.
- History stores each session and applied doses/notes.

## Unidades
- Diameter: meters
- Water height: cm
- Volume: liters
- Chlorine: ppm
- Concentrations: % (editable)

## Definition of Done
- Installable PWA with manifest + service worker.
- Works offline (load + navigate).
- Settings persist.
- Sessions saved to History.
- Basic validations prevent progressing with empty fields.

