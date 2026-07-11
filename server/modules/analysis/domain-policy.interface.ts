import type { ReviewDomain } from '@shared/api.interface';

export interface DomainPolicyProvider {
  readonly domain: ReviewDomain;
  readonly version: string;
  getWorkflowSteps(): string[];
  getRiskTaxonomy(): string[];
}
