/**
 * テスト用に、合成した RSA 鍵で Cognito 形式のアクセストークンを発行する。
 *
 * JWKS を取得しに行かず、実際の署名検証の経路を通したテストを書くためのもの。
 * 本番コードから import しない。
 */
import { generateKeyPairSync, sign } from 'node:crypto';
import type { Jwks } from 'aws-jwt-verify/jwk';

export interface TestTokenIssuerOptions {
  /** 例: `us-east-1_Example1`。実在の User Pool ID を使わない。 */
  userPoolId: string;
  clientId: string;
}

export interface TestTokenIssuer {
  /** 検証器の `jwks` オプションに渡す公開鍵 */
  readonly jwks: Jwks;
  readonly issuer: string;
  /**
   * 有効なアクセストークンを発行する。`claims` で任意の項目を上書きできる
   * （`exp` を過去にする、`token_use: 'id'` にする、など）。
   */
  accessToken(claims?: Record<string, unknown>): string;
}

export function createTestTokenIssuer(options: TestTokenIssuerOptions): TestTokenIssuer {
  const region = options.userPoolId.split('_')[0];
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${options.userPoolId}`;
  const kid = 'aws-kit-test-key';
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwks = {
    keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }],
  } as unknown as Jwks;

  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

  return {
    jwks,
    issuer,
    accessToken(claims = {}) {
      const now = Math.floor(Date.now() / 1000);
      const body = `${encode({ alg: 'RS256', kid, typ: 'JWT' })}.${encode({
        sub: 'test-sub',
        iss: issuer,
        client_id: options.clientId,
        token_use: 'access',
        username: 'test-user',
        iat: now,
        exp: now + 600,
        ...claims,
      })}`;
      return `${body}.${sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')}`;
    },
  };
}
