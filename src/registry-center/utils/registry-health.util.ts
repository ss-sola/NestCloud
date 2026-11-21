import { HEARTBEAT_INTERVAL } from '@nest-cloud/sdk';
import {
  HEARTBEAT_GRACE_MS,
  HEARTBEAT_HEALTH_THRESHOLD,
  INSTANCE_HEALTH_SCORES,
  SERVICE_HEALTH_SCORE_THRESHOLDS,
} from '../registry.constants';
import type {
  RegistryInstance,
  RegistryInstanceHealth,
  RegistryInstanceSummary,
  RegistryServiceSummary,
} from '../registry.types';

export class RegistryHealthUtil {
  static nextSuccessStreak(instance: RegistryInstance, now: number): number {
    if (this.missedHeartbeats(instance, now) > 0) return 1;
    return Math.min((instance.heartbeatSuccessStreak ?? 0) + 1, HEARTBEAT_HEALTH_THRESHOLD);
  }

  static serviceHealth(
    instances: RegistryInstanceSummary[],
  ): Pick<RegistryServiceSummary, 'health' | 'healthScore'> {
    const active = instances.filter((instance) => !instance.disabled);
    if (active.length === 0) return { health: 'unavailable', healthScore: null };

    const total = active.reduce(
      (sum, instance) => sum + INSTANCE_HEALTH_SCORES[instance.health],
      0,
    );
    const healthScore = Math.round(total / active.length);
    if (healthScore >= SERVICE_HEALTH_SCORE_THRESHOLDS.healthy) {
      return { health: 'healthy', healthScore };
    }
    if (healthScore >= SERVICE_HEALTH_SCORE_THRESHOLDS.warning) {
      return { health: 'warning', healthScore };
    }
    return { health: 'critical', healthScore };
  }

  static instanceHealth(instance: RegistryInstance, now: number): RegistryInstanceHealth {
    const missed = this.missedHeartbeats(instance, now);
    if (missed >= HEARTBEAT_HEALTH_THRESHOLD) return 'critical';
    if (missed > 0 || (instance.heartbeatSuccessStreak ?? 0) < HEARTBEAT_HEALTH_THRESHOLD) {
      return 'warning';
    }
    return 'healthy';
  }

  private static missedHeartbeats(instance: RegistryInstance, now: number): number {
    return Math.max(
      0,
      Math.floor((now - instance.lastHeartbeat - HEARTBEAT_GRACE_MS) / HEARTBEAT_INTERVAL),
    );
  }
}
