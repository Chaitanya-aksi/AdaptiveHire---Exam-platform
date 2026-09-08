import { resolveBranding } from './candidate-branding';

/**
 * The rule a candidate reads off every screen and every email: whose assessment
 * is this?
 *
 * Worth its own suite because the answer is consulted from three places that
 * must agree — the invitation list, the record of one attempt, and the
 * rejection email — and because getting it wrong shows a stranger's logo to
 * somebody being asked to sign in.
 */
describe('resolveBranding', () => {
  const group = {
    name: 'AKSI Aerospace Group',
    logoUrl: 'https://group.example/logo.png',
    accentColor: '#123456',
    supportEmail: 'careers@group.example',
  };

  const subsidiary = {
    name: 'KhetPilot',
    logoUrl: 'https://khetpilot.example/logo.png',
    accentColor: '#00aa66',
    supportEmail: 'jobs@khetpilot.example',
  };

  it('shows the workspace when the round names no company', () => {
    // The pre-existing behaviour, and what a customer who is a single company
    // always gets. Adding group companies must not change it.
    expect(resolveBranding(group, null, 'platform@adaptivehire.test')).toEqual({
      name: 'AKSI Aerospace Group',
      logoUrl: 'https://group.example/logo.png',
      accentColor: '#123456',
      supportEmail: 'careers@group.example',
    });
  });

  it('prefers the company the candidate actually applied to', () => {
    expect(
      resolveBranding(group, subsidiary, 'platform@adaptivehire.test'),
    ).toEqual({
      name: 'KhetPilot',
      logoUrl: 'https://khetpilot.example/logo.png',
      accentColor: '#00aa66',
      supportEmail: 'jobs@khetpilot.example',
    });
  });

  /*
   * The reason this resolves field by field instead of picking a row.
   *
   * A group of six brands commonly runs one recruiting inbox and one palette,
   * so the ordinary company row carries a name and a logo and nothing else.
   * Taking the company wholesale would strip the accent and leave candidates
   * with no way to ask for help.
   */
  it('inherits the group palette and inbox a company leaves unset', () => {
    const nameAndLogoOnly = {
      name: 'Roboclave',
      logoUrl: 'https://roboclave.example/logo.png',
      accentColor: null,
      supportEmail: null,
    };

    expect(
      resolveBranding(group, nameAndLogoOnly, 'platform@adaptivehire.test'),
    ).toEqual({
      name: 'Roboclave',
      logoUrl: 'https://roboclave.example/logo.png',
      accentColor: '#123456',
      supportEmail: 'careers@group.example',
    });
  });

  it('falls through to the platform address when nobody has set one', () => {
    const noInbox = { ...group, supportEmail: null };

    expect(
      resolveBranding(noInbox, null, 'platform@adaptivehire.test').supportEmail,
    ).toBe('platform@adaptivehire.test');
  });

  it('offers no contact route rather than a dead one', () => {
    // Null is a real answer: the portal then shows nothing at all, because
    // somebody who has just lost an attempt is worse served by an address
    // nobody reads than by none.
    const noInbox = { ...group, supportEmail: null };

    expect(resolveBranding(noInbox, null, null).supportEmail).toBeNull();
  });

  it('degrades to the platform when no relation was loaded', () => {
    expect(resolveBranding(null, null, null)).toEqual({
      name: 'AdaptiveHire',
      logoUrl: null,
      accentColor: null,
      supportEmail: null,
    });
  });

  it('does not treat an empty logo as a value to inherit past', () => {
    // A company with a null logo shows the group's, not an initial badge —
    // `??` and not `||`, so a company is never made to look unbranded by a
    // field it simply has not filled in.
    const noLogo = { ...subsidiary, logoUrl: null };

    expect(resolveBranding(group, noLogo, null).logoUrl).toBe(
      'https://group.example/logo.png',
    );
    expect(resolveBranding(group, noLogo, null).name).toBe('KhetPilot');
  });
});
