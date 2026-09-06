import { test, expect } from 'bun:test'
import { domainNativeCopy } from '../src/domain-native-i18n.ts'

const locales = ['en', 'fr', 'es', 'pt', 'de', 'zh-Hans', 'ar', 'hi', 'bn', 'id', 'ja', 'ru', 'it', 'ko', 'tr', 'vi', 'ur', 'nl', 'pl', 'fa']

test('domain native notification catalogue covers all supported locales', () => {
  for (const locale of locales) {
    const copy = domainNativeCopy(locale)
    expect(copy.activitySubtitle).toBeTruthy()
    expect(copy.markRead).toBeTruthy()
  }
})

test('domain native notification catalogue keeps RTL labels readable', () => {
  expect(domainNativeCopy('ar').markRead).toContain('مقروءة')
  expect(domainNativeCopy('fa').markRead).toContain('خوانده')
  expect(domainNativeCopy('ur').markRead).toContain('پڑھا')
})
