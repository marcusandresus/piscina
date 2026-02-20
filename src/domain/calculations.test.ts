import { describe, expect, it } from "vitest";
import {
  calculateChlorineDose,
  calculateChlorineDoseMl,
  calculatePhMlPerStep,
  calculatePhCorrectionMl,
  calculatePhRaiseDose,
  calculateVolumeLiters,
  classifyChlorine,
  classifyPh,
  estimatePhAfterAcidDose,
  isChlorineInRange,
  isHeightInRange,
  isPhInRange,
  toFixedNumber
} from "./calculations";
import { defaultPoolConfig } from "./defaults";

describe("calculateVolumeLiters", () => {
  it("calcula volumen cilindrico con altura real", () => {
    const volumeLiters = calculateVolumeLiters(3.05, 76);
    expect(volumeLiters).toBeCloseTo(5552.686475403619, 9);
    expect(toFixedNumber(volumeLiters, 0)).toBe(5553);
  });
});

describe("calculatePhCorrectionMl", () => {
  it("retorna 0 si el pH ya esta en objetivo maximo o menor", () => {
    const volumeLiters = calculateVolumeLiters(3.05, 76);
    expect(calculatePhCorrectionMl(7.6, volumeLiters, 10, 7.6, 100)).toBe(0);
    expect(calculatePhCorrectionMl(7.4, volumeLiters, 10, 7.6, 100)).toBe(0);
  });

  it("calcula dosis para pH 7.8 con acido al 10%", () => {
    const volumeLiters = calculateVolumeLiters(3.05, 76);
    const totalMl = calculatePhCorrectionMl(7.8, volumeLiters, 10, 7.6, 100);
    expect(totalMl).toBeCloseTo(87.31599482572199, 9);
    expect(toFixedNumber(totalMl, 0)).toBe(87);
  });

  it("calcula dosis para pH 8.2 con acido al 10%", () => {
    const volumeLiters = calculateVolumeLiters(3.05, 76);
    const totalMl = calculatePhCorrectionMl(8.2, volumeLiters, 10, 7.6, 100);
    expect(totalMl).toBeCloseTo(261.94798447716556, 9);
    expect(toFixedNumber(totalMl, 0)).toBe(262);
  });

  it("retorna 0 con concentracion de acido invalida", () => {
    const volumeLiters = calculateVolumeLiters(3.05, 76);
    expect(calculatePhCorrectionMl(8, volumeLiters, 0, 7.6, 100)).toBe(0);
  });

  it("escala dosis de pH segun alcalinidad estimada", () => {
    const volumeLiters = calculateVolumeLiters(3.05, 76);
    const doseAt100 = calculatePhCorrectionMl(7.8, volumeLiters, 10, 7.6, 100);
    const doseAt150 = calculatePhCorrectionMl(7.8, volumeLiters, 10, 7.6, 150);

    expect(doseAt150).toBeCloseTo(doseAt100 * 1.5, 9);
  });

  it("estima pH luego de aplicar una dosis conocida", () => {
    const volumeLiters = calculateVolumeLiters(3.05, 76);
    const mlPerStep = calculatePhMlPerStep(volumeLiters, 10, 100);
    const estimated = estimatePhAfterAcidDose(7.8, mlPerStep * 2, volumeLiters, 10, 100);
    expect(estimated).toBeCloseTo(7.6, 9);
  });
});

describe("calculateChlorineDoseMl", () => {
  it("calcula dosis de mantencion y correctiva para cloro muy bajo", () => {
    const volumeLiters = calculateVolumeLiters(3.05, 76);
    const result = calculateChlorineDoseMl(0.2, volumeLiters, 5, 1, 3);

    expect(result.maintenanceMl).toBeCloseTo(88.8429836064579, 9);
    expect(result.correctiveMl).toBeCloseTo(199.8967131145303, 9);
    expect(toFixedNumber(result.maintenanceMl, 0)).toBe(89);
    expect(toFixedNumber(result.correctiveMl, 0)).toBe(200);
  });

  it("si el cloro esta sobre el minimo, mantencion es 0 y correctiva puede ser positiva", () => {
    const volumeLiters = calculateVolumeLiters(3.05, 76);
    const result = calculateChlorineDoseMl(1.5, volumeLiters, 5, 1, 3);

    expect(result.maintenanceMl).toBe(0);
    expect(result.correctiveMl).toBeCloseTo(55.52686475403619, 9);
    expect(toFixedNumber(result.correctiveMl, 0)).toBe(56);
  });

  it("retorna 0 para ambas dosis con concentracion de cloro invalida", () => {
    const volumeLiters = calculateVolumeLiters(3.05, 76);
    const result = calculateChlorineDoseMl(0.2, volumeLiters, 0, 1, 3);
    expect(result).toEqual({ maintenanceMl: 0, correctiveMl: 0 });
  });
});

describe("calculateChlorineDose", () => {
  it("devuelve gramos cuando el producto es granulado", () => {
    const volumeLiters = calculateVolumeLiters(3.05, 76);
    const result = calculateChlorineDose(0.2, volumeLiters, 56, "granular-g", 1, 3);

    expect(result.unit).toBe("g");
    expect(result.maintenance).toBeCloseTo(7.9324092505766, 9);
    expect(result.corrective).toBeCloseTo(17.847920813797344, 9);
  });
});

describe("calculatePhRaiseDose", () => {
  it("calcula dosis de pH+ cuando el pH esta bajo objetivo", () => {
    const volumeLiters = calculateVolumeLiters(3.05, 76);
    const dose = calculatePhRaiseDose(7.0, volumeLiters, 100, 7.2, 18);
    expect(dose).toBeCloseTo(19.98967131145303, 9);
  });

  it("retorna 0 cuando no corresponde subir pH", () => {
    const volumeLiters = calculateVolumeLiters(3.05, 76);
    expect(calculatePhRaiseDose(7.2, volumeLiters, 100, 7.2, 18)).toBe(0);
    expect(calculatePhRaiseDose(7.0, volumeLiters, 0, 7.2, 18)).toBe(0);
  });
});

describe("validaciones y clasificaciones", () => {
  it("valida rangos esperados de pH y cloro", () => {
    expect(isPhInRange(6.8)).toBe(true);
    expect(isPhInRange(8.2)).toBe(true);
    expect(isPhInRange(8.3)).toBe(false);

    expect(isChlorineInRange(0)).toBe(true);
    expect(isChlorineInRange(10)).toBe(true);
    expect(isChlorineInRange(10.1)).toBe(false);
  });

  it("valida altura con maximo configurable", () => {
    expect(isHeightInRange(50, 76)).toBe(true);
    expect(isHeightInRange(77, 76)).toBe(false);
    expect(isHeightInRange(0, 76)).toBe(false);
  });

  it("clasifica pH y cloro segun objetivos configurados", () => {
    expect(classifyPh(7.4, defaultPoolConfig)).toBe("ok");
    expect(classifyPh(7.7, defaultPoolConfig)).toBe("leve");
    expect(classifyPh(8.1, defaultPoolConfig)).toBe("ajuste");

    expect(classifyChlorine(2, defaultPoolConfig)).toBe("ok");
    expect(classifyChlorine(0.8, defaultPoolConfig)).toBe("leve");
    expect(classifyChlorine(0.2, defaultPoolConfig)).toBe("ajuste");
  });
});
