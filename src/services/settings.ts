import { db } from '../db/database';
import { nowIso } from '../utils/format';
import type { Actor } from '../types';
import { assertAction } from './core';

export const SETTING_KEYS = {
  WORKSHOP_INFO: 'workshopInfo',
  PRINT_CONFIG: 'printConfig',
  APP_META: 'appMeta',
} as const;

export interface WorkshopInfo {
  name: string;
  address: string;
  taxCode: string;
  phone: string;
  representative: string;
  email?: string;
  website?: string;
  slogan?: string;
}

export interface PrintConfig {
  footerNote: string;
  showSignatures: boolean;
}

export interface AppMetaSetting {
  appName: string;
  version: string;
}

export const DEFAULT_WORKSHOP_INFO: WorkshopInfo = {
  name: 'Xưởng Cơ khí KhoaDev',
  address: 'Lô C3 Khu công nghiệp Tân Tiến, Hà Nội',
  taxCode: '0109876543',
  phone: '024 3456 7890',
  representative: 'Đặng Quốc Hưng',
  email: 'khoadev.company@gmail.com',
  website: 'khoadev.vn',
  slogan: 'Gia công cơ khí chính xác — đúng hạn, đúng chuẩn',
};

export const DEFAULT_PRINT_CONFIG: PrintConfig = {
  footerNote: 'Chứng từ in từ FactoryOne — hệ thống quản lý sản xuất xưởng gia công.',
  showSignatures: true,
};

export const DEFAULT_APP_META: AppMetaSetting = {
  appName: 'FactoryOne',
  version: '1.0.0',
};

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const record = await db.settings.get(key);
  if (!record) return fallback;
  return record.value as T;
}

export async function upsertSetting(actor: Actor, key: string, value: unknown): Promise<void> {
  assertAction(actor, 'settings.manage');
  await db.transaction('rw', db.settings, async () => {
    await db.settings.put({ key, value, updatedAt: nowIso() });
  });
}
