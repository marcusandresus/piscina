# PWA de Mantenimiento de Piscina  
Diseño Funcional y Técnico (v1)

## 1. Objetivo

Diseñar una **PWA offline-first** para guiar el mantenimiento químico de una piscina armable, usando:
- Medición manual de pH (Phenol Red)
- Medición manual de cloro (Orthotolidine)
- Cálculo automático de dosis
- Corrección segura de pH en dos etapas
- Registro histórico simple

La app debe ser usable **desde el celular, al borde de la piscina**, sin conexión a internet.

---

## 2. Principios de diseño

- **Offline-first**: todo funciona sin red
- **Guía paso a paso**: minimizar errores humanos
- **Datos semi-estáticos configurables**
- **Datos dinámicos por sesión**
- **Interfaz simple, alto contraste, botones grandes**
- **Evitar sobrecorrecciones (especialmente pH)**

---

## 3. Modelo conceptual de datos

### 3.1 Configuración (semi-estática)

Persistente entre sesiones. Se modifica solo cuando cambian insumos o criterios.

#### Piscina
- `diameter_m` (ej. 3.05)
- `max_height_cm` (opcional, informativo)

#### Productos químicos
- **Cloro**
  - `type` (ej. hipoclorito de sodio)
  - `concentration` (ej. % disponible)
  - `unit` (% / g/L)
- **Ácido muriático**
  - `concentration` (editable)
  - `unit`

#### Objetivos químicos
- `ph_target_min` (ej. 7.2)
- `ph_target_max` (ej. 7.6)
- `chlorine_target_min_ppm` (ej. 1)
- `chlorine_target_max_ppm` (ej. 3)

> Regla: todo lo que **cambia cada varias semanas** va aquí.

---

### 3.2 Sesión de ajuste (por medición)

Se crea **cada vez que se inicia un ajuste**.

- `timestamp`
- `water_height_cm`
- `measured_ph`
- `measured_chlorine_ppm`

Derivados:
- `calculated_volume_liters`
- `required_ph_correction`
- `required_chlorine_dose`

> Regla: todo lo que **cambia día a día** va aquí.

---

## 4. Flujo de usuario

### 4.1 Pantalla inicial – Estado

- Datos de piscina
- Última medición
- Botón principal: **“Nueva medición”**

---

### 4.2 Nueva sesión – Medición

1. Ingresar altura actual del agua  
   (slider con rango válido)
2. Ingresar lectura de pH  
   (escala visual Phenol Red)
3. Ingresar lectura de cloro  
   (escala visual Orthotolidine)

---

### 4.3 Evaluación automática

Clasificación por parámetro:
- 🟢 OK
- 🟡 Ajuste leve
- 🔴 Ajuste requerido

Comparación contra objetivos configurados.

---

### 4.4 Corrección guiada

#### pH (obligatorio en 2 etapas)
- Cálculo total requerido
- Aplicar **solo el 50% en Etapa 1**
- Indicar:
  - cantidad exacta
  - encender bomba
  - esperar 4–6 horas
- Re-medición antes de Etapa 2

#### Cloro
- Cálculo según:
  - volumen real del día
  - concentración configurada
- Diferenciar:
  - dosis de mantención
  - dosis correctiva

---

### 4.5 Checklist post-aplicación

- ⬜ Bomba encendida
- ⬜ Químicos diluidos correctamente
- ⬜ Aplicación perimetral
- ⬜ Tiempo de espera respetado

---

## 5. Historial

Registro simple por sesión:
- Fecha/hora
- Altura del agua
- pH / cloro medidos
- Dosis aplicadas
- Notas opcionales

Exportable (v2).

---

## 6. Cálculos internos

- Volumen:

volumen = π × (diámetro / 2)² × altura

- Todos los cálculos deben poder mostrarse como:

**“¿Cómo se calculó?”** (transparencia).

---

## 7. Arquitectura técnica (v1)

- Vite + React + TypeScript
- PWA (Service Worker)
- Almacenamiento local:
- IndexedDB o localStorage
- Sin backend
- Una piscina

---

## 8. Roadmap

### v1
- Asistente químico completo
- Offline
- Configuración + sesiones
- Historial básico

### v2
- Recordatorios
- Exportación PDF / CSV
- Múltiples piscinas

### v3
- Asistencia por cámara para lectura de color
- Reglas según clima / uso

---

## 9. Regla de oro del sistema

> **La app nunca debe permitir una corrección agresiva en un solo paso.**  
Especialmente pH: siempre en dos etapas.

---
