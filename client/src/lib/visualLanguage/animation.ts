export const ANIMATION = {
  cycleDuration: 8.7,

  breath: {
    speed:       0.5,
    flutterFreq: 1.6,
    flutterAmp:  0.08,
    pulseFreq:   1.0,
    pulseAmp:    0.18,
    ghostPulseF: 0.4,
    normCenter:  0.5,
    normRange:   0.5,
    minRhythm:   0.05,
  },
  drift: {
    speed:   0.3,
    ampFact: 0.025,
    vertRat: 0.6,
    xPhase:  0,        yPhase: 2.0,      zPhase: 0,
  },
  orbit: {
    speed:  0.4,
    factor: 0.18,
  },
  ghostDrift: {
    baseAmp: 0.06,     sevAmp: 0.03,     speed: 0.2,
    xPhase: 1.0,       yPhase: 3.0,      zPhase: 2.0,
    xFreq:  1.0,       yFreq:  0.7,      zFreq:  0.8,
  },
  reveal: {
    rate:           1.5,
    layerStagger:   0.12,
    activationRamp: 0.02,
    progressScale:  2,
  },
  sag:           { maxFactor: 0.3 },
  oscillate: {
    speed: 0.8, ampFact: 0.025, freqA: 1.3, freqB: 1.1, severityMult: 0.5,
  },
  stressPulse: {
    speed: 0.35, scaleBase: 0.06, scaleSev: 0.06, sevPhase: 3,
  },
  scan: {
    proxThresh: 0.8, actThresh: 0.5, scanNear: 0.5,
  },
  thermal: {
    rampRate: 0.015, severityMin: 0.3, maxPoints: 20,
  },
  attention: {
    lifetime: 2.5,    scanThresh: 0.6, scaleBase: 0.15,
    scaleGrowth: 0.4, scaleSev: 0.5,  opacityBase: 0.5,
    opacitySev: 0.3,  maxDelay: 0.3,  cooldown: 2.5,
    lifetimePad: 0.5,
  },
  causalFloat: { speed: 1.2, amp: 0.006 },
  markerScale: { base: 0.15, sevF: 0.5 },
  markerDrift: { amp: 0.025, vertRat: 0.6 },
} as const;
