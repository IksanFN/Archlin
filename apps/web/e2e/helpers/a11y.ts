import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function expectNoA11yViolations(page: Page): Promise<void> {
  // axe reads the painted colours, so an entrance animation caught at partial opacity reads as a contrast failure.
  // allSettled because a cancelled animation rejects its finished promise; endless ones (spinners) never settle.
  await page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished),
    ),
  );
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const summary = results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(' ')).slice(0, 5),
  }));
  expect(summary, `axe violations on ${page.url()}`).toEqual([]);
}
