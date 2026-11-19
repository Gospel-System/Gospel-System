import { beforeAll, describe, expect, it } from 'vitest';
import { activate, adminSession, loggedIn, login, logout, publishedMembers, session } from '../src/lib/members';
import { makeMember } from '../src/model/members';

/** Parcours complet : temporaire → choix du mot de passe personnel → connexions suivantes → réinitialisation. */
describe('connexion : temporaire puis mot de passe personnel', () => {
  beforeAll(async () => {
    publishedMembers.value = [
      await makeMember('hasina', 'temp-admin', true, 1000),
      await makeMember('misa', 'temp-misa', false, 1000),
    ];
  });

  it('refuse un mauvais mot de passe, demande l\'activation avec le temporaire', async () => {
    expect(await login('misa', 'nimporte')).toBe('bad');
    expect(await login('inconnu', 'temp-misa')).toBe('bad');
    expect(session.value).toBeNull();
    expect(await login(' MISA ', 'temp-misa')).toBe('activate');
    expect(session.value).toBeNull();
  });

  it('activation : règles du mot de passe personnel, puis session ouverte', async () => {
    expect(await activate('misa', 'temp-misa', 'court', 'court')).toMatch(/8/);
    expect(await activate('misa', 'temp-misa', 'temp-misa', 'temp-misa')).toMatch(/différent/);
    expect(await activate('misa', 'temp-misa', 'motdepasse1', 'motdepasse2')).toMatch(/différentes/);
    expect(await activate('misa', 'faux-temp', 'motdepasse1', 'motdepasse1')).toMatch(/plus valable/);
    expect(session.value).toBeNull();
    expect(await activate('misa', 'temp-misa', 'motdepasse1', 'motdepasse1')).toBeNull();
    expect(session.value?.id).toBe('misa');
    expect(loggedIn.value).toBe(true);
    expect(adminSession.value).toBe(false);
  });

  it('ensuite seul le mot de passe personnel est accepté sur cet appareil', async () => {
    await logout();
    expect(loggedIn.value).toBe(false);
    expect(await login('misa', 'temp-misa')).toBe('bad');
    expect(await login('misa', 'motdepasse1')).toBe('ok');
    expect(loggedIn.value).toBe(true);
  });

  it('temporaire redéfini : session close, réactivation exigée', async () => {
    publishedMembers.value = [
      ...publishedMembers.value!.filter((m) => m.id !== 'misa'),
      await makeMember('misa', 'nouveau-temp', false, 1000),
    ];
    expect(loggedIn.value).toBe(false);
    await logout();
    expect(await login('misa', 'motdepasse1')).toBe('bad');
    expect(await login('misa', 'nouveau-temp')).toBe('activate');
    expect(await activate('misa', 'nouveau-temp', 'autre-mdp-1', 'autre-mdp-1')).toBeNull();
    await logout();
    expect(await login('misa', 'autre-mdp-1')).toBe('ok');
  });

  it('un autre membre est indépendant (admin)', async () => {
    await logout();
    expect(await login('hasina', 'temp-admin')).toBe('activate');
    expect(await activate('hasina', 'temp-admin', 'admin-perso-1', 'admin-perso-1')).toBeNull();
    expect(adminSession.value).toBe(true);
  });
});
