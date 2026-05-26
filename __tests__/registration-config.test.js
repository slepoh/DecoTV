/* global afterAll, beforeEach, describe, expect, it, jest */

const mockDb = {
  getAdminConfig: jest.fn(),
  saveAdminConfig: jest.fn(),
};

jest.mock('@/lib/db', () => ({
  db: mockDb,
}));

const { getConfig, invalidateConfigCache } = require('../src/lib/config');

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function createStoredConfig(registrationSettings = {}) {
  return {
    ConfigFile: '',
    ConfigSubscribtion: {
      URL: '',
      AutoUpdate: false,
      LastCheck: '',
    },
    SiteConfig: {
      SiteName: 'DecoTV',
      Announcement: '',
      SearchDownstreamMaxPage: 5,
      SiteInterfaceCacheTime: 7200,
      DoubanProxyType: 'auto',
      DoubanProxy: '',
      DoubanImageProxyType: 'auto',
      DoubanImageProxy: '',
      TmdbProxyType: 'direct',
      TmdbProxy: '',
      TmdbReverseProxy: '',
      DisableYellowFilter: false,
      FluidSearch: true,
      SearchResultLoadMode: 'infinite',
    },
    UserConfig: {
      ...registrationSettings,
      Users: [{ username: 'owner', role: 'owner', banned: false }],
      Tags: [{ name: 'limited', enabledApis: [] }],
    },
    SourceConfig: [],
    CustomCategories: [],
    LiveConfig: [],
    PanSouConfig: {
      activeNodeId: 'node',
      nodes: [
        {
          id: 'node',
          name: 'node',
          serverUrl: 'https://pansou.example.com',
          token: '',
          username: '',
          password: '',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    },
    TMDBConfig: {
      ApiKey: '',
      ProxyType: 'direct',
      Proxy: '',
      ReverseProxy: '',
    },
    PrivateLibraryConfig: {
      connectors: [],
    },
  };
}

describe('persisted registration settings', () => {
  const originalOwner = process.env.USERNAME;
  const originalRegistrationEnabled =
    process.env.NEXT_PUBLIC_ENABLE_REGISTRATION;
  const originalRegistrationGroup = process.env.DEFAULT_REGISTRATION_GROUP;

  beforeEach(() => {
    invalidateConfigCache();
    mockDb.getAdminConfig.mockReset();
    mockDb.saveAdminConfig.mockReset();
    process.env.USERNAME = 'owner';
  });

  afterAll(() => {
    restoreEnv('USERNAME', originalOwner);
    restoreEnv('NEXT_PUBLIC_ENABLE_REGISTRATION', originalRegistrationEnabled);
    restoreEnv('DEFAULT_REGISTRATION_GROUP', originalRegistrationGroup);
  });

  it('migrates legacy environment defaults into stored admin config', async () => {
    let storedConfig = createStoredConfig();
    process.env.NEXT_PUBLIC_ENABLE_REGISTRATION = 'true';
    process.env.DEFAULT_REGISTRATION_GROUP = 'limited';
    mockDb.getAdminConfig.mockImplementation(async () => storedConfig);
    mockDb.saveAdminConfig.mockImplementation(async (config) => {
      storedConfig = config;
    });

    const result = await getConfig();

    expect(result.UserConfig.RegistrationEnabled).toBe(true);
    expect(result.UserConfig.RegistrationDefaultUserGroup).toBe('limited');
    expect(mockDb.saveAdminConfig).toHaveBeenCalled();
    expect(storedConfig.UserConfig.RegistrationEnabled).toBe(true);
  });

  it('keeps an explicit admin switch value instead of rereading env defaults', async () => {
    const storedConfig = createStoredConfig({
      RegistrationEnabled: false,
      RegistrationDefaultUserGroup: '',
    });
    process.env.NEXT_PUBLIC_ENABLE_REGISTRATION = 'true';
    process.env.DEFAULT_REGISTRATION_GROUP = 'limited';
    mockDb.getAdminConfig.mockResolvedValue(storedConfig);

    const result = await getConfig();

    expect(result.UserConfig.RegistrationEnabled).toBe(false);
    expect(result.UserConfig.RegistrationDefaultUserGroup).toBe('');
    expect(mockDb.saveAdminConfig).not.toHaveBeenCalled();
  });
});
