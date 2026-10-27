import { beforeEach, describe, expect, it } from 'bun:test'

import type {
  AccountRepositoryRead,
  AccountRow,
  RoutingSettings,
} from '../../src/core/account-repository-types.ts'
import {
  type AntigravityMenuAccounts,
  type AntigravityMenuSettings,
  type AntigravityRepositoryMenuOptions,
  createAntigravityCommandMenu,
} from '../../src/core/antigravity-command-menu.ts'
import { loadCommonAuthCommands } from '../../src/core/common-auth-runtime.ts'

let rows: AccountRow[]
let routing: RoutingSettings

const repository: AntigravityMenuAccounts = {
  read: async () => ({ status: 'ready', rows, routing }),
  setEnabled: async (ref, input) => {
    const row = rows.find((entry) => entry.ref === ref)
    if (!row) throw new Error('missing fixture row')
    row.enabled = input.enabled
    return { ref }
  },
  remove: async (ref) => {
    rows = rows.filter((row) => row.ref !== ref)
  },
  selectAccount: async (target, ref) => {
    if (target === 'active') routing.activeRow = ref
    else routing.activeRowByFamily = { ...routing.activeRowByFamily, [target]: ref }
  },
}

beforeEach(() => {
  routing = { schemaVersion: 1 }
  rows = ['first', 'second'].map((name, index) => ({
    ref: { id: crypto.randomUUID(), credentialEpoch: 1, identity: `${name}@example.com` },
    index,
    enabled: true,
    usable: true,
    stamp: 'bound',
    credential: { refreshToken: `refresh-${name}-secret` },
    metadata: {
      status: 'present',
      metadata: { email: `${name}@example.com`, addedAt: 1, lastUsed: 1 },
    },
    quota: { status: 'absent' },
  }))
})

const invocation = { notify: () => undefined }

async function readyRows(): Promise<
  Extract<AccountRepositoryRead, { status: 'ready' }>['rows']
> {
  const read = await repository.read()
  if (read.status !== 'ready') throw new Error(read.status)
  return read.rows
}

async function menu(
  settingsLog: AntigravityMenuSettings[] = [],
  refreshQuota?: AntigravityRepositoryMenuOptions['refreshQuota'],
  accountLimits?: AntigravityRepositoryMenuOptions['accountLimits'],
  reauthorize?: AntigravityRepositoryMenuOptions['reauthorize'],
  selectionStrategy: () => AntigravityMenuSettings['selectionStrategy'] = () =>
    'hybrid',
) {
  let settings: AntigravityMenuSettings = {
    selectionStrategy: 'hybrid',
    killswitch: { enabled: false, minimumRemainingPercent: 5 },
  }
  return createAntigravityCommandMenu({
    source: 'repository',
    commands: await loadCommonAuthCommands(),
    accounts: repository,
    settings: {
      read: () => ({ ...settings, selectionStrategy: selectionStrategy() }),
      updateKillswitch: async (killswitch) => {
        settings = { ...settings, killswitch }
        settingsLog.push(settings)
      },
    },
    ...(refreshQuota ? { refreshQuota } : {}),
    ...(accountLimits ? { accountLimits } : {}),
    ...(reauthorize ? { reauthorize } : {}),
  })
}

async function accountItemIds(
  built: Awaited<ReturnType<typeof menu>>,
): Promise<string[]> {
  const payload = await built.open(invocation)
  const accounts = payload.menu.sections.find(
    (section) => section.id === 'accounts',
  )
  return accounts?.items.map((item) => item.id) ?? []
}

describe('createAntigravityCommandMenu', () => {
  it('shows the four account slots in order without row ids, emails or tokens', async () => {
    const built = await menu()
    const payload = await built.open(invocation)
    expect(payload.command).toBe('antigravity')
    expect(payload.menu.sections.map((section) => section.slot)).toEqual([
      'accounts',
      'quota',
      'routing',
      'limits',
    ])
    const text = JSON.stringify(payload)
    for (const row of await readyRows()) expect(text).not.toContain(row.ref.id)
    expect(text).not.toContain('@example.com')
    expect(text).not.toContain('secret')
    const items = payload.menu.sections[0]?.items ?? []
    expect(items.map((item) => item.label)).toEqual(['Account 1', 'Account 2'])
    expect(items.every((item) => item.account === undefined)).toBe(true)
  })

  it('disables exactly the credential the item was opened for', async () => {
    const built = await menu()
    const [, second] = await accountItemIds(built)
    if (!second) throw new Error('missing account')
    const result = await built.apply(
      {
        command: 'antigravity',
        sectionId: 'accounts',
        itemId: second,
        actionId: 'disable',
      },
      invocation,
    )
    expect(result.ok).toBe(true)
    expect((await readyRows()).map((row) => row.enabled)).toEqual([true, false])
  })

  it('refuses an item whose credential was replaced, writing nothing', async () => {
    const built = await menu()
    const [first] = await accountItemIds(built)
    if (!first) throw new Error('missing account')
    const [row] = await readyRows()
    if (!row) throw new Error('missing row')
    row.ref = { ...row.ref, credentialEpoch: row.ref.credentialEpoch + 1 }
    row.credential = { refreshToken: 'refresh-replaced-secret' }
    const result = await built.apply(
      {
        command: 'antigravity',
        sectionId: 'accounts',
        itemId: first,
        actionId: 'disable',
      },
      invocation,
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe('unavailable')
    expect((await readyRows()).map((entry) => entry.enabled)).toEqual([
      true,
      true,
    ])
    const [renewed] = await accountItemIds(built)
    expect(renewed).not.toBe(first)
  })

  it('keeps item ids across a reorder', async () => {
    const built = await menu()
    const [first, second] = await accountItemIds(built)
    if (!first || !second) throw new Error('missing items')
    rows.reverse()
    expect(await accountItemIds(built)).toEqual([second, first])
  })

  it('removes only after the library confirmation', async () => {
    const built = await menu()
    const [first] = await accountItemIds(built)
    if (!first) throw new Error('missing account')
    const request = {
      command: 'antigravity',
      sectionId: 'accounts',
      itemId: first,
      actionId: 'remove',
    }
    const unconfirmed = await built.apply(request, invocation)
    expect(unconfirmed.needsConfirmation).toBe(true)
    expect(await readyRows()).toHaveLength(2)
    const confirmed = await built.apply(
      { ...request, confirmed: true },
      invocation,
    )
    expect(confirmed.ok).toBe(true)
    expect(await readyRows()).toHaveLength(1)
  })

  it('shows read-only account routing without header-style controls', async () => {
    const built = await menu()
    const result = await built.open(invocation)
    const routing = result.menu.sections.find(
      (section) => section.id === 'routing',
    )
    expect(routing?.lines).toEqual([
      'Account selection strategy: hybrid',
      'Choose available accounts using health and quota signals.',
      'Configured in antigravity.json: account_selection_strategy',
    ])
    expect(routing?.actions).toEqual([])
    expect(JSON.stringify(routing)).not.toMatch(/Gemini CLI|header.style/i)
    const stale = await built.apply(
      {
        command: 'antigravity',
        sectionId: 'routing',
        actionId: 'set',
        values: {},
      },
      invocation,
    )
    expect(stale.ok).toBe(false)
  })
})

describe('createAntigravityCommandMenu quota check', () => {
  const request = {
    command: 'antigravity',
    sectionId: 'quota',
    actionId: 'refresh',
  }

  it('offers no check action without a quota service', async () => {
    const payload = await (await menu()).open(invocation)
    const quota = payload.menu.sections.find((entry) => entry.id === 'quota')
    expect(quota?.actions).toEqual([])
  })

  it('checks exactly the rows read and reports the readings taken', async () => {
    const asked: string[][] = []
    const built = await menu([], async (refs) => {
      asked.push(refs.map((ref) => ref.id))
      return { checked: 1, notChecked: 1 }
    })
    const result = await built.apply(request, invocation)
    expect(asked).toEqual([(await readyRows()).map((row) => row.ref.id)])
    expect(result).toMatchObject({
      ok: true,
      text: 'Quota checked for 1 of 2 accounts; 1 could not be checked',
    })
  })

  it('never reports success when no reading was taken', async () => {
    const built = await menu([], async () => ({ checked: 0, notChecked: 2 }))
    const result = await built.apply(request, invocation)
    expect(result).toMatchObject({ ok: false, code: 'quota-unavailable' })
  })
})

describe('createAntigravityCommandMenu account quota floor', () => {
  it('offers no floor action without a host floor source', async () => {
    const payload = await (await menu()).open(invocation)
    const accounts = payload.menu.sections.find(
      (entry) => entry.id === 'accounts',
    )
    expect(
      accounts?.items.flatMap((item) =>
        item.actions.map((action) => action.id),
      ),
    ).not.toContain('limit')
  })

  it('writes the floor for exactly the credential the item was opened for', async () => {
    const floors = new Map<string, number>()
    const written: unknown[] = []
    const built = await menu([], undefined, {
      read: (ref) => floors.get(ref.id) ?? null,
      write: async (ref, value) => {
        written.push({ ref, value })
        if (value === null) floors.delete(ref.id)
        else floors.set(ref.id, value)
        return 'applied'
      },
    })
    const [, second] = await accountItemIds(built)
    const [, secondRow] = await readyRows()
    if (!second || !secondRow) throw new Error('missing account')
    const result = await built.apply(
      {
        command: 'antigravity',
        sectionId: 'accounts',
        itemId: second,
        actionId: 'limit',
        values: { minimumRemainingPercent: 25 },
      },
      invocation,
    )
    expect(result).toMatchObject({
      ok: true,
      text: 'Account 2 quota floor set to 25%',
    })
    expect(written).toEqual([{ ref: secondRow.ref, value: 25 }])
    const item = result.menu.sections
      .find((entry) => entry.id === 'accounts')
      ?.items.find((entry) => entry.id === second)
    expect(item?.detail).toContain('floor 25%')
    expect(JSON.stringify(result)).not.toContain(secondRow.ref.id)
  })

  it('reports a stale credential from the host and claims nothing', async () => {
    const built = await menu([], undefined, {
      read: () => null,
      write: async () => 'stale',
    })
    const [first] = await accountItemIds(built)
    if (!first) throw new Error('missing account')
    const result = await built.apply(
      {
        command: 'antigravity',
        sectionId: 'accounts',
        itemId: first,
        actionId: 'limit',
        values: { minimumRemainingPercent: 10 },
      },
      invocation,
    )
    expect(result).toMatchObject({ ok: false, code: 'stale-account' })
  })
})

describe('createAntigravityCommandMenu reauthorization', () => {
  it('hands the host exactly the credential the item was opened for', async () => {
    const asked: unknown[] = []
    const built = await menu([], undefined, undefined, {
      run: async (ref, run) => {
        asked.push({ ref, sessionId: run.sessionId })
        return 'Waiting for the browser sign-in'
      },
    })
    const [, second] = await accountItemIds(built)
    const [, secondRow] = await readyRows()
    if (!second || !secondRow) throw new Error('missing account')
    const result = await built.apply(
      {
        command: 'antigravity',
        sectionId: 'accounts',
        itemId: second,
        actionId: 'reauthorize',
      },
      { sessionId: 'ses-1', notify: () => undefined },
    )
    expect(result).toMatchObject({
      ok: true,
      text: 'Waiting for the browser sign-in',
    })
    expect(asked).toEqual([{ ref: secondRow.ref, sessionId: 'ses-1' }])
  })
})

describe('createAntigravityCommandMenu sections mode', () => {
  it('dispatches host item ids through the library without reading the repository', async () => {
    // Sections mode takes no repository at all; the store must be exactly
    // as it was after the host's action ran.
    const before = JSON.stringify(await readyRows())
    const ran: string[] = []
    const section = (title: string) => ({
      title,
      build: () => ({
        lines: [`${title} for the signed-in account`],
        items: [
          {
            id: 'login-1',
            label: 'Signed-in account',
            actions: [
              {
                id: 'sign-out',
                label: 'Sign out',
                irreversible: true as const,
                confirm: 'Sign out?',
                run: async () => {
                  ran.push(title)
                  return 'Signed out'
                },
              },
            ],
          },
        ],
      }),
    })
    const built = createAntigravityCommandMenu({
      source: 'sections',
      commands: await loadCommonAuthCommands(),
      sections: {
        accounts: section('Accounts'),
        quota: section('Quota'),
        routing: section('Routing'),
        limits: section('Limits'),
      },
    })
    const payload = await built.open(invocation)
    expect(payload.menu.sections.map((entry) => entry.slot)).toEqual([
      'accounts',
      'quota',
      'routing',
      'limits',
    ])
    const request = {
      command: 'antigravity',
      sectionId: 'accounts',
      itemId: 'login-1',
      actionId: 'sign-out',
    }
    expect((await built.apply(request, invocation)).needsConfirmation).toBe(
      true,
    )
    expect(ran).toEqual([])
    const done = await built.apply({ ...request, confirmed: true }, invocation)
    expect(done.ok).toBe(true)
    expect(ran).toEqual(['Accounts'])
    expect(JSON.stringify(await readyRows())).toBe(before)
  })

  it('refuses an incomplete sections mode at construction', async () => {
    const commands = await loadCommonAuthCommands()
    const sections = {
      accounts: { title: 'Accounts', build: () => ({}) },
      quota: { title: 'Quota', build: () => ({}) },
      routing: { title: 'Routing', build: () => ({}) },
    }
    // Built outside the type checker, as a JavaScript caller would.
    expect(() =>
      Reflect.apply(createAntigravityCommandMenu, undefined, [
        { source: 'sections', commands, sections },
      ]),
    ).toThrow('limits section')
    expect(() =>
      Reflect.apply(createAntigravityCommandMenu, undefined, [
        { source: 'pool', commands },
      ]),
    ).toThrow('repository or sections')
  })
})

it('reads each account strategy fresh and explains vault selection without inventing a strategy', async () => {
  let strategy: AntigravityMenuSettings['selectionStrategy'] = 'sticky'
  const built = await menu([], undefined, undefined, undefined, () => strategy)
  for (const current of ['sticky', 'round-robin', 'hybrid', 'vault'] as const) {
    strategy = current
    const payload = await built.open(invocation)
    const routing = payload.menu.sections.find(
      (section) => section.id === 'routing',
    )
    expect(routing?.actions).toEqual([])
    expect(JSON.stringify(routing)).not.toMatch(/Gemini CLI|header.style/i)
    if (current === 'vault') {
      expect(routing?.lines).toEqual([
        "Selection follows the vault's served accounts.",
      ])
    } else {
      expect(routing?.lines[0]).toBe(`Account selection strategy: ${current}`)
      expect(routing?.lines).toHaveLength(3)
      expect(routing?.lines[2]).toBe(
        'Configured in antigravity.json: account_selection_strategy',
      )
    }
  }
})
