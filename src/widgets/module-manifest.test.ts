import { describe, expect, it } from 'vitest';
import { ManifestError, manifestToDraft, parseModuleManifest } from './module-manifest';

const header = (body: string) => `/**\n${body}\n */\nNowly.defineModule(() => {});`;

describe('parseModuleManifest', () => {
  it('parses a full manifest header', () => {
    const source = header(
      [
        ' * @nowly-module 1',
        ' * @id           weather-widget',
        ' * @name         天气',
        ' * @version      1.0.0',
        ' * @author       alice',
        ' * @description  显示天气',
        ' * @permissions  state, today, network',
        ' * @network      api.open-meteo.com, API.Weather.com',
        ' * @minSize      3x3',
        ' * @defaultSize  4x5'
      ].join('\n')
    );
    const manifest = parseModuleManifest(source);
    expect(manifest.id).toBe('weather-widget');
    expect(manifest.name).toBe('天气');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.author).toBe('alice');
    expect(manifest.permissions).toEqual(['state', 'today', 'network']);
    expect(manifest.network).toEqual(['api.open-meteo.com', 'api.weather.com']);
    expect(manifest.minW).toBe(3);
    expect(manifest.minH).toBe(3);
    expect(manifest.defaultW).toBe(4);
    expect(manifest.defaultH).toBe(5);
  });

  it('defaults size and optional fields', () => {
    const manifest = parseModuleManifest(
      header([' * @nowly-module 1', ' * @id timer', ' * @name 计时', ' * @version 0.1.0'].join('\n'))
    );
    expect(manifest.permissions).toEqual([]);
    expect(manifest.network).toEqual([]);
    expect(manifest.minW).toBe(2);
    expect(manifest.defaultW).toBe(4);
    expect(manifest.author).toBe('');
  });

  it('rejects a missing header', () => {
    expect(() => parseModuleManifest('Nowly.defineModule(() => {});')).toThrow(ManifestError);
  });

  it('rejects a bad manifest version tag', () => {
    expect(() =>
      parseModuleManifest(header([' * @nowly-module 2', ' * @id a', ' * @name n', ' * @version 1'].join('\n')))
    ).toThrow('bad-version-tag');
  });

  it('rejects an invalid id', () => {
    expect(() =>
      parseModuleManifest(
        header([' * @nowly-module 1', ' * @id Bad_Id', ' * @name n', ' * @version 1'].join('\n'))
      )
    ).toThrow('bad-id');
  });

  it('rejects unknown permissions', () => {
    expect(() =>
      parseModuleManifest(
        header(
          [' * @nowly-module 1', ' * @id a', ' * @name n', ' * @version 1', ' * @permissions wallpaper'].join('\n')
        )
      )
    ).toThrow('unknown-permission');
  });

  it('rejects network permission without hosts', () => {
    expect(() =>
      parseModuleManifest(
        header(
          [' * @nowly-module 1', ' * @id a', ' * @name n', ' * @version 1', ' * @permissions network'].join('\n')
        )
      )
    ).toThrow('network-without-hosts');
  });

  it('rejects hosts without the network permission', () => {
    expect(() =>
      parseModuleManifest(
        header(
          [
            ' * @nowly-module 1',
            ' * @id a',
            ' * @name n',
            ' * @version 1',
            ' * @network api.example.com'
          ].join('\n')
        )
      )
    ).toThrow('hosts-without-network');
  });
});

describe('manifestToDraft', () => {
  it('maps a manifest and source into an install draft', () => {
    const source = header(
      [
        ' * @nowly-module 1',
        ' * @id a',
        ' * @name 名称',
        ' * @version 1.0.0',
        ' * @permissions state, network',
        ' * @network api.example.com',
        ' * @defaultSize 6x4'
      ].join('\n')
    );
    const draft = manifestToDraft(parseModuleManifest(source), source);
    expect(draft.name).toBe('名称');
    expect(draft.permissions).toEqual(['state', 'network']);
    expect(draft.allowedHosts).toEqual(['api.example.com']);
    expect(draft.defaultW).toBe(6);
    expect(draft.defaultH).toBe(4);
    expect(draft.source).toBe(source);
  });
});
