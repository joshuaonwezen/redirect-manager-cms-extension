import {isAbsolute, norm, withoutLocale, type AddConfirm, type NewRule} from '../../shared/redirects';

/** Something about a new rule the editor should see before it goes live. */
export interface AddRisk {
  code: AddConfirm;
  message: string;
}

/** What the network checks found: a published page the rule would hide, a destination that isn't there. */
export interface RiskFacts {
  hiddenPage: string | null;
  missingDestination: string | null;
}

/** "and everything under it" on a top-level path (/en, /personal) takes a whole section of the site. */
export function isBroad(rule: Pick<NewRule, 'fromPath' | 'matchSubpaths'>): boolean {
  return rule.matchSubpaths && rule.fromPath.split('/').filter(Boolean).length <= 1;
}

/**
 * The first published page the rule would send visitors away from, or null. /x and /en/x
 * count as the same page, as a site routed by Graph URLs serves both.
 */
export function hiddenPage(rule: Pick<NewRule, 'fromPath' | 'matchSubpaths'>, pageUrls: string[], locale: string): string | null {
  const strip = (p: string) => withoutLocale(p, locale) ?? norm(p);
  const from = strip(rule.fromPath);
  const hit = pageUrls.find((url) => {
    const page = strip(url);
    return page === from || (rule.matchSubpaths && from !== '/' && page.startsWith(`${from}/`));
  });
  return hit ? norm(hit) : null;
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Every risk of adding `rule`, in the order the editor is asked about them. */
export function addRisks(rule: NewRule, facts: RiskFacts): AddRisk[] {
  const risks: AddRisk[] = [];
  if (isAbsolute(rule.toPath)) {
    risks.push({
      code: 'external_destination',
      message: `This sends visitors to another website, ${host(rule.toPath)}. Check that ${rule.toPath} is the address you mean.`,
    });
  }
  if (isBroad(rule)) {
    risks.push({
      code: 'broad_subpaths',
      message: `This redirects ${rule.fromPath} and every address under it - a whole section of the site.`,
    });
  }
  if (facts.hiddenPage) {
    risks.push({
      code: 'hides_page',
      message: `A published page lives at ${facts.hiddenPage}. Visitors will be sent away before it shows - fine for a short vanity address, not for a page people still need.`,
    });
  }
  if (facts.missingDestination) {
    risks.push({
      code: 'destination_missing',
      message: `${facts.missingDestination} doesn't exist on the site, so visitors would land on a "page not found".`,
    });
  }
  return risks;
}

/** The first risk the editor hasn't confirmed yet. */
export function unconfirmed(risks: AddRisk[], confirm: AddConfirm[]): AddRisk | null {
  return risks.find((r) => !confirm.includes(r.code)) ?? null;
}
