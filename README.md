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
  - esperar 30-60 minutos (piscinas de bajo volumen, con recirculación activa)
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

### 6.1 Notación

- $d$: diámetro de piscina $[\mathrm{m}]$
- $h_{cm}$: altura de agua $[\mathrm{cm}]$
- $V_L$: volumen de agua $[\mathrm{L}]$
- $pH_m$: pH medido
- $pH_{max}$: pH objetivo máximo (tope del rango)
- $A$: concentración de ácido muriático (porcentaje, %)
- $TA$: alcalinidad total estimada $[\mathrm{ppm}]$
- $Cl_m$: cloro medido $[\mathrm{ppm}]$
- $Cl_{min}$, $Cl_{max}$: límites objetivo de cloro $[\mathrm{ppm}]$
- $Cl_{pct}$: concentración de cloro líquido (porcentaje, %)

### 6.2 Volumen de piscina (cilindro)

$$
V_L = \pi \left(\frac{d}{2}\right)^2 \left(\frac{h_{cm}}{100}\right)\cdot 1000
$$

### 6.3 Corrección de pH (ácido muriático)

Si $pH_m \le pH_{max}$ o $A \le 0$, la dosis es 0.

En caso contrario:

$$
\Delta pH = pH_m - pH_{max}
$$

$$
S = \frac{\Delta pH}{0.1}
$$

$$
F_V = \frac{V_L}{10000}
$$

$$
F_A = \frac{31.45}{A}
$$

$$
F_{TA} = \max\left(0.4,\frac{TA}{100}\right)
$$

$$
D_{pH,ml} = \max\left(0,S\cdot 25 \cdot F_A \cdot F_V \cdot F_{TA}\right)
$$

Donde 25 ml es la referencia por cada 0.1 de pH en 10,000 L con ácido al 31.45%.

Aplicación en dos etapas:

$$
E_{1,ml} = 0.5 \cdot D_{pH,ml}
$$

### 6.4 Dosis de cloro

Objetivo central:

$$
Cl_{mid} = \frac{Cl_{min}+Cl_{max}}{2}
$$

Déficits:

$$
\Delta Cl_{min} = \max(0, Cl_{min}-Cl_m)
$$

$$
\Delta Cl_{mid} = \max(0, Cl_{mid}-Cl_m)
$$

Masa requerida de cloro activo (usando $1\ \mathrm{ppm}=1\ \mathrm{mg/L}$):

$$
mg_{min} = \Delta Cl_{min}\cdot V_L
$$

$$
mg_{mid} = \Delta Cl_{mid}\cdot V_L
$$

Conversión de concentración líquida:

$$
mg_{ml} = Cl_{pct}\cdot 10
$$

Si $Cl_{pct} \le 0$, ambas dosis son 0.

Si no:

$$
D_{mant,ml} = \frac{mg_{min}}{mg_{ml}}
$$

$$
D_{corr,ml} = \frac{mg_{mid}}{mg_{ml}}
$$

Interpretación:
- `mantención`: llegar al mínimo del rango objetivo.
- `correctiva`: llegar al valor central del rango objetivo.

### 6.5 Estados de evaluación

- pH:
  - `ok`: $pH_m \in [pH_{min}, pH_{max}]$
  - `leve`: $pH_m \in [pH_{min}-0.2, pH_{max}+0.2]$
  - `ajuste`: fuera de ese margen
- Cloro:
  - `ok`: $Cl_m \in [Cl_{min}, Cl_{max}]$
  - `leve`: $Cl_m \in [Cl_{min}-0.5, Cl_{max}+0.5]$
  - `ajuste`: fuera de ese margen

### 6.6 Suposiciones necesarias

1. Geometría ideal de cilindro para estimar volumen.
2. Mezcla suficientemente homogénea con recirculación.
3. $TA$ no medido en campo: se usa valor estimado (por defecto 100 ppm).
4. La sensibilidad del pH al ácido se modela de forma lineal por tramos de 0.1 pH.
5. La concentración comercial de cloro se aproxima como $mg_{ml} = Cl_{pct}\times10$.
6. Se prioriza seguridad operacional: corrección de pH en al menos dos pasos, con re-medición intermedia (en piscinas de bajo volumen, referencia típica de espera: 30-60 minutos con recirculación activa).

Todos los cálculos deben poder mostrarse como “¿Cómo se calculó?” para trazabilidad.

### 6.7 Ejemplo numérico completo

Parámetros de ejemplo (alineados con configuración por defecto):

- $d=3.05\ \mathrm{m}$
- $h_{cm}=76\ \mathrm{cm}$
- $pH_m=7.8$, $pH_{max}=7.6$
- $A=10\%$
- $TA=100\ \mathrm{ppm}$
- $Cl_m=0.2\ \mathrm{ppm}$, $Cl_{min}=1$, $Cl_{max}=3$
- $Cl_{pct}=5\%$

Resultados esperados (aprox.):

1. Volumen:
   $$
   V_L \approx 5552.69\ \mathrm{L}
   $$
2. pH total:
   $$
   D_{pH,ml} \approx 87.32\ \mathrm{ml}
$$
3. pH etapa 1 (50%):
   $$
   E_{1,ml} \approx 43.66\ \mathrm{ml}
$$
4. Cloro mantención (hasta mínimo):
   $$
   D_{mant,ml} \approx 88.84\ \mathrm{ml}
$$
5. Cloro correctiva (hasta central):
   $$
   D_{corr,ml} \approx 199.90\ \mathrm{ml}
$$

En la UI estos valores se muestran redondeados a ml enteros.

### 6.8 Alcance y límites del modelo

1. Es un modelo práctico-operativo, no una simulación fisicoquímica completa del sistema carbonato.
2. El factor $F_{TA}$ mejora la aproximación al incluir alcalinidad estimada, pero no reemplaza medición real de TA.
3. Cambios de temperatura, carga orgánica, exposición solar y calidad del reactivo pueden desviar el resultado teórico.
4. Por seguridad, cualquier corrección de pH se valida con re-medición antes de segunda etapa.
5. Si los parámetros de entrada son extremos o inconsistentes (concentración $\le 0$, lecturas fuera de rango), la app fuerza dosis 0 o bloquea avance.

### 6.9 Tabla rápida de QA manual

Casos base recomendados para validar cálculo y redondeo visual (ml enteros en UI).

| Caso | Inputs | Esperado en dominio (aprox.) | Esperado en UI |
|---|---|---|---|
| Volumen base | $d=3.05$, $h=76$ cm | $V_L=5552.69$ L | `5553 L` |
| pH sin ajuste | $pH_m=7.6$, $pH_{max}=7.6$, $A=10\%$, $TA=100$ | `0 ml` | `0 ml` |
| pH moderado | $pH_m=7.8$, $pH_{max}=7.6$, $A=10\%$, $TA=100$ | `87.32 ml` | `87 ml` |
| pH alto | $pH_m=8.2$, $pH_{max}=7.6$, $A=10\%$, $TA=100$ | `261.95 ml` | `262 ml` |
| pH con mayor TA | igual caso pH moderado pero $TA=150$ | `130.97 ml` | `131 ml` |
| Cloro muy bajo | $Cl_m=0.2$, $Cl_{min}=1$, $Cl_{max}=3$, $Cl_{pct}=5\%$ | mant. `88.84 ml`, corr. `199.90 ml` | mant. `89 ml`, corr. `200 ml` |
| Cloro intermedio | $Cl_m=1.5$, $Cl_{min}=1$, $Cl_{max}=3$, $Cl_{pct}=5\%$ | mant. `0 ml`, corr. `55.53 ml` | mant. `0 ml`, corr. `56 ml` |
| Concentración inválida | $Cl_{pct}\le0$ o $A\le0$ | dosis `0 ml` | dosis `0 ml` |

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

