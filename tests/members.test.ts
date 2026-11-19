import { describe, expect, it } from 'vitest';
import {
  credentialCurrent, hasAdmin, isAdmin, makeLocalCredential, makeMember, parseMembers, serializeMembers, sessionValid,
  validateId, validatePassword, validatePersonal, verify, verifyLocal,
} from '../src/model/members';

describe('membres', () => {
  it('empreinte : bon / mauvais mot de passe, identifiant insensible à la casse', async () => {
    const m = await makeMember(' Hasina ', 'Tsiky-2026', true, 1000);
    expect(m.id).toBe('hasina');
    expect(JSON.stringify(m)).not.toContain('Tsiky');
    expect(await verify([m], 'HASINA', 'Tsiky-2026')).toEqual(m);
    expect(await verify([m], 'hasina', 'tsiky-2026')).toBeNull();
    expect(await verify([m], 'misa', 'Tsiky-2026')).toBeNull();
  });
  it('deux membres au même mot de passe : empreintes différentes (sel)', async () => {
    const [a, b] = await Promise.all([makeMember('a1', 'secret1', false, 1000), makeMember('b1', 'secret1', false, 1000)]);
    expect(a.hash).not.toBe(b.hash);
  });
  it('session : 120 jours, membre retiré, temporaire redéfini, admin relu', async () => {
    const m = await makeMember('hasina', 'secret1', true, 1000);
    const now = Date.now();
    const s = { id: 'hasina', admin: true, at: now - 119 * 86_400_000, bind: m.hash };
    expect(sessionValid(s, [m], now)).toBe(true);
    expect(sessionValid({ ...s, at: now - 121 * 86_400_000 }, [m], now)).toBe(false);
    expect(sessionValid(s, [], now)).toBe(false);
    const reset = await makeMember('hasina', 'autre-temp', true, 1000);
    expect(sessionValid(s, [reset], now)).toBe(false);
    expect(sessionValid({ ...s, bind: '' }, [m], now)).toBe(false);
    expect(isAdmin(s, [{ ...m, admin: undefined }])).toBe(false);
    expect(isAdmin({ ...s, admin: false }, [m])).toBe(true);
  });
  it('mot de passe personnel : local, lié au temporaire publié', async () => {
    const m = await makeMember('misa', 'temporaire1', false, 1000);
    const c = await makeLocalCredential(m, 'Mon-mot-de-passe', 1000);
    expect(JSON.stringify(c)).not.toContain('Mon-mot');
    expect(credentialCurrent(c, m)).toBe(true);
    expect(await verifyLocal(c, 'Mon-mot-de-passe')).toBe(true);
    expect(await verifyLocal(c, 'temporaire1')).toBe(false);
    const reset = await makeMember('misa', 'nouveau-temp', false, 1000);
    expect(credentialCurrent(c, reset)).toBe(false);
    expect(credentialCurrent(c, undefined)).toBe(false);
    expect(credentialCurrent(undefined, m)).toBe(false);
  });
  it('validation du mot de passe personnel', () => {
    expect(validatePersonal('1234567', '1234567', 'temp')).toMatch(/8/);
    expect(validatePersonal('motdepasse', 'motdepasse', 'motdepasse')).toMatch(/différent/);
    expect(validatePersonal('motdepasse', 'motdepass', 'temp')).toMatch(/différentes/);
    expect(validatePersonal('motdepasse', 'motdepasse', 'temp')).toBeNull();
  });
  it('validations', async () => {
    const m = await makeMember('misa', 'secret1', false, 1000);
    expect(validateId('Misa', [m])).toMatch(/existe déjà/);
    expect(validateId('a b', [])).toMatch(/sans espace/);
    expect(validateId('Toky', [m])).toBeNull();
    expect(validatePassword('12345')).toMatch(/6/);
    expect(validatePassword('123456')).toBeNull();
    expect(hasAdmin([m])).toBe(false);
    expect(hasAdmin([])).toBe(true);
  });
  it('sérialisation stable', async () => {
    const list = [await makeMember('toky', 'secret1', false, 1000), await makeMember('hasina', 'secret1', true, 1000)];
    const s = serializeMembers(list);
    expect(parseMembers(JSON.parse(s)).map((m) => m.id)).toEqual(['hasina', 'toky']);
    expect(() => parseMembers([{ id: 'x' }])).toThrow();
  });
});
