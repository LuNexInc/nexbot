import type { InstanceInfo } from "@/state/types";

/** Providers that are current enough to expose in user-facing selectors. */
export function pickerInstances(instances: InstanceInfo[]): InstanceInfo[] {
  return instances.filter((instance) => instance.driverKind !== "geminiAgent");
}
