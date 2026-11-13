// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests", "<rootDir>/src"],
  moduleNameMapper: {
    "^@toolbox/(.*)$": "<rootDir>/vendor/toolbox/tools/$1",
    // Tests don't load 3D models (same stub the Toolbox uses).
    "\.glb$": "<rootDir>/vendor/toolbox/tools/contact-center-3d/tests/glbStub.js"
  }
};
