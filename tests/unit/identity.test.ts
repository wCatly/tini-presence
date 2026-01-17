import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  getIdentity,
  getDeviceFolder,
  setTestIdentity,
  resetIdentity,
  TEST_IDENTITY,
} from "../../src/identity.ts";

describe("Identity", () => {
  describe("with test identity", () => {
    beforeEach(() => {
      setTestIdentity(TEST_IDENTITY);
    });

    afterEach(() => {
      resetIdentity();
    });

    test("getIdentity returns test identity", () => {
      const identity = getIdentity();
      expect(identity.id).toBe("test1234");
      expect(identity.name).toBe("test-machine");
    });

    test("getDeviceFolder returns test folder", () => {
      const folder = getDeviceFolder();
      expect(folder).toBe("test-machine-test1234");
    });
  });

  describe("with real identity", () => {
    test("getIdentity returns consistent identity", () => {
      const id1 = getIdentity();
      const id2 = getIdentity();
      
      expect(id1.id).toBe(id2.id);
      expect(id1.name).toBe(id2.name);
      expect(id1.id.length).toBe(8);
    });

    test("getDeviceFolder contains name and id", () => {
      const folder = getDeviceFolder();
      const identity = getIdentity();
      
      expect(folder).toContain(identity.name);
      expect(folder).toContain(identity.id);
      expect(folder).toBe(`${identity.name}-${identity.id}`);
    });

    test("identity has valid structure", () => {
      const identity = getIdentity();
      
      expect(typeof identity.id).toBe("string");
      expect(typeof identity.name).toBe("string");
      expect(typeof identity.createdAt).toBe("string");
      expect(identity.id.length).toBe(8);
      expect(identity.name.length).toBeGreaterThan(0);
      // createdAt should be valid ISO date
      expect(new Date(identity.createdAt).toISOString()).toBe(identity.createdAt);
    });
  });

  describe("TEST_IDENTITY constant", () => {
    test("has expected values", () => {
      expect(TEST_IDENTITY.id).toBe("test1234");
      expect(TEST_IDENTITY.name).toBe("test-machine");
      expect(TEST_IDENTITY.createdAt).toBe("2024-01-01T00:00:00.000Z");
    });
  });
});
