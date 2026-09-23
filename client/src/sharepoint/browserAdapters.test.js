import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLibraryBoundFolderViaJsom } from './browserAdapters.js';

describe('library-bound JSOM folder creation', () => {
  let calls;
  let jsomFailure;

  beforeEach(() => {
    calls = [];
    jsomFailure = null;
    const item = {
      update: vi.fn(() => calls.push(['update'])),
      get_id: () => 27,
      get_fileSystemObjectType: () => 1,
      get_item: () => '/sites/schedule/Data Lib/אב/שם זהה',
    };
    const list = {
      addItem: vi.fn((creation) => {
        calls.push(['addItem', creation]);
        return item;
      }),
    };
    const lists = {
      getById: vi.fn((id) => {
        calls.push(['getById', id]);
        return list;
      }),
    };
    class ListItemCreationInformation {
      set_underlyingObjectType(value) { calls.push(['type', value]); }
      set_folderUrl(value) { calls.push(['parent', value]); }
      set_leafName(value) { calls.push(['leaf', value]); }
    }
    class ClientContext {
      constructor(webUrl) {
        calls.push(['context', webUrl]);
      }
      get_web() { return { get_lists: () => lists }; }
      load(target, fields) { calls.push(['load', target, fields]); }
      executeQueryAsync(success, failure) {
        if (jsomFailure) failure(this, jsomFailure);
        else success();
      }
    }
    window.SP = {
      ClientContext,
      ListCreationInformation: class {},
      ListItemCreationInformation,
      FileSystemObjectType: { folder: 1 },
    };
  });

  it('uses exact web, verified list ID, real parent and exact Hebrew leaf', async () => {
    const webUrl = 'https://portal.army.idf/sites/schedule';
    const parentPath = '/sites/schedule/Data Lib/אב';
    const folderPath = `${parentPath}/שם זהה`;
    const result = await createLibraryBoundFolderViaJsom(webUrl)({
      libraryId: 'LIST-GUID',
      parentPath,
      leafName: 'שם זהה',
      folderPath,
    });

    expect(result).toMatchObject({ created: true, listItemId: 27, fileSystemObjectType: 1 });
    expect(calls).toContainEqual(['context', webUrl]);
    expect(calls).toContainEqual(['getById', 'LIST-GUID']);
    expect(calls).toContainEqual(['type', 1]);
    expect(calls).toContainEqual(['parent', parentPath]);
    expect(calls).toContainEqual(['leaf', 'שם זהה']);
    expect(calls.filter(([name]) => name === 'addItem')).toHaveLength(1);
    expect(calls.filter(([name]) => name === 'update')).toHaveLength(1);
  });

  it('rejects a mismatched or invalid leaf before issuing a JSOM mutation', async () => {
    const create = createLibraryBoundFolderViaJsom('https://portal.army.idf/sites/schedule');
    await expect(create({
      libraryId: 'LIST-GUID',
      parentPath: '/sites/schedule/siteDB/parent',
      leafName: 'child',
      folderPath: '/sites/schedule/siteDB/other/child',
    })).rejects.toMatchObject({ code: 'FOLDER_PATH_MISMATCH' });
    await expect(create({
      libraryId: 'LIST-GUID',
      parentPath: '/sites/schedule/siteDB/parent',
      leafName: 'bad/name',
      folderPath: '/sites/schedule/siteDB/parent/bad/name',
    })).rejects.toMatchObject({ code: 'INVALID_FOLDER_NAME' });
    expect(calls.filter(([name]) => name === 'addItem')).toHaveLength(0);
  });

  it('surfaces JSOM permission, duplicate, and unavailable-parent classifications', async () => {
    const create = createLibraryBoundFolderViaJsom('https://portal.army.idf/sites/schedule');
    jsomFailure = {
      get_message: () => 'Access denied.',
      get_errorCode: () => -2147024891,
      get_errorTypeName: () => 'System.UnauthorizedAccessException',
    };
    await expect(create({
      libraryId: 'LIST-GUID',
      parentPath: '/sites/schedule/siteDB',
      leafName: 'child',
      folderPath: '/sites/schedule/siteDB/child',
    })).rejects.toMatchObject({ errorClass: 'PERMISSION_DENIED', sharePointCode: '-2147024891' });
    expect(calls.filter(([name]) => name === 'addItem')).toHaveLength(1);

    calls.length = 0;
    jsomFailure = {
      get_message: () => 'A folder with this name already exists.',
      get_errorCode: () => -2130575257,
      get_errorTypeName: () => 'Microsoft.SharePoint.SPException',
    };
    await expect(create({
      libraryId: 'LIST-GUID',
      parentPath: '/sites/schedule/siteDB',
      leafName: 'child',
      folderPath: '/sites/schedule/siteDB/child',
    })).rejects.toMatchObject({ errorClass: 'ALREADY_EXISTS' });
    expect(calls.filter(([name]) => name === 'addItem')).toHaveLength(1);

    calls.length = 0;
    jsomFailure = {
      get_message: () => 'The parent folder does not exist.',
      get_errorCode: () => -2147024893,
      get_errorTypeName: () => 'System.IO.DirectoryNotFoundException',
    };
    await expect(create({
      libraryId: 'LIST-GUID',
      parentPath: '/sites/schedule/siteDB',
      leafName: 'child',
      folderPath: '/sites/schedule/siteDB/child',
    })).rejects.toMatchObject({ errorClass: 'MISSING', sharePointCode: '-2147024893' });
    expect(calls.filter(([name]) => name === 'addItem')).toHaveLength(1);
  });
});
