import { defineProject, mergeConfig } from "vitest/config";
import { base } from "../vitest.base.ts";

export default mergeConfig(base, defineProject({ test: { name: "client" } }));
