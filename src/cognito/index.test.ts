import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Jwks } from 'aws-jwt-verify/jwk';
import {
  createCognitoAccessTokenVerifier,
  createCognitoAccessTokenVerifierFromEnv,
  extractBearerToken,
  httpStatusFor,
  parseAllowedSubs,
} from './index.js';

// すべて合成値。実在の User Pool・Client・利用者とは関係ない。
const POOL = 'us-east-1_Example1';
const CLIENT = 'exampleclientid1234567890';
const ISSUER = `https://cognito-idp.us-east-1.amazonaws.com/${POOL}`;

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = {
  keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }],
} as unknown as Jwks;

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function token(claims: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64url({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })}.${b64url({
    sub: 'sub-owner',
    iss: ISSUER,
    client_id: CLIENT,
    token_use: 'access',
    username: 'owner',
    iat: now,
    exp: now + 600,
    ...claims,
  })}`;
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')}`;
}

const verifier = (extra: { allowedSubs?: Iterable<string> } = {}) =>
  createCognitoAccessTokenVerifier({ userPoolId: POOL, clientId: CLIENT, jwks, ...extra });

describe('createCognitoAccessTokenVerifier', () => {
  it('有効なアクセストークンから sub と username を返す', async () => {
    const result = await verifier().verify(token());
    expect(result).toMatchObject({ ok: true, sub: 'sub-owner', username: 'owner' });
  });

  it('空・未指定は missing', async () => {
    expect(await verifier().verify(undefined)).toEqual({ ok: false, reason: 'missing' });
    expect(await verifier().verify('   ')).toEqual({ ok: false, reason: 'missing' });
  });

  it.each([
    ['ID トークン', { token_use: 'id', aud: CLIENT }],
    ['別プロダクトの Client', { client_id: 'otherclientid' }],
    ['別の User Pool', { iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Other1' }],
    ['期限切れ', { exp: Math.floor(Date.now() / 1000) - 60 }],
  ])('%s は invalid', async (_label, claims) => {
    expect(await verifier().verify(token(claims))).toEqual({ ok: false, reason: 'invalid' });
  });

  it('署名が改ざんされていれば invalid', async () => {
    const [h, , s] = token().split('.');
    const forged = `${h}.${b64url({ sub: 'intruder', iss: ISSUER, client_id: CLIENT, token_use: 'access', exp: 9999999999 })}.${s}`;
    expect(await verifier().verify(forged)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('許可リストに無い sub は forbidden', async () => {
    expect(await verifier({ allowedSubs: ['someone-else'] }).verify(token())).toEqual({
      ok: false,
      reason: 'forbidden',
    });
    expect((await verifier({ allowedSubs: ['sub-owner'] }).verify(token())).ok).toBe(true);
  });

  it('許可リストを空で渡すと誰も通さない', async () => {
    expect(await verifier({ allowedSubs: [] }).verify(token())).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('User Pool ID か Client ID が空なら作れない', () => {
    expect(() => createCognitoAccessTokenVerifier({ userPoolId: '', clientId: CLIENT })).toThrow();
    expect(() => createCognitoAccessTokenVerifier({ userPoolId: POOL, clientId: [] })).toThrow();
  });
});

describe('createCognitoAccessTokenVerifierFromEnv', () => {
  it('必要な環境変数が無ければ例外', () => {
    expect(() => createCognitoAccessTokenVerifierFromEnv({ COGNITO_USER_POOL_ID: POOL })).toThrow(
      'COGNITO_CLIENT_ID',
    );
  });

  it('許可リストの変数名を指定して値が空なら、誰も通さない', async () => {
    const env = { COGNITO_USER_POOL_ID: POOL, COGNITO_CLIENT_ID: CLIENT, ALLOWED_USER_SUBS: '' };
    const v = createCognitoAccessTokenVerifierFromEnv(env, { allowedSubs: 'ALLOWED_USER_SUBS' }, { jwks });
    expect(await v.verify(token())).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('許可リストの変数名を指定しなければ sub では絞らない', async () => {
    const env = { COGNITO_USER_POOL_ID: POOL, COGNITO_CLIENT_ID: CLIENT };
    expect((await createCognitoAccessTokenVerifierFromEnv(env, {}, { jwks }).verify(token())).ok).toBe(true);
  });
});

describe('helpers', () => {
  it('parseAllowedSubs は空要素を捨てる', () => {
    expect([...parseAllowedSubs(' a, ,b ,')]).toEqual(['a', 'b']);
    expect(parseAllowedSubs(undefined).size).toBe(0);
  });

  it('extractBearerToken', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractBearerToken('bearer abc')).toBe('abc');
    expect(extractBearerToken('Basic abc')).toBeNull();
    expect(extractBearerToken('Bearer a b')).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it('httpStatusFor', () => {
    expect(httpStatusFor('missing')).toBe(401);
    expect(httpStatusFor('invalid')).toBe(401);
    expect(httpStatusFor('forbidden')).toBe(403);
  });
});
