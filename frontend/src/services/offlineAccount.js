import { cacheAccount, clearCachedAccount } from './offlineStore';

export async function cacheAccountForOffline(account, expiresAt) {
  if (account?.role === 'user') return cacheAccount(account, expiresAt);
  return clearCachedAccount();
}
