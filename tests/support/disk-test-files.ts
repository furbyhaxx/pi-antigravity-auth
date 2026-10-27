// These suites assert crash recovery, durable publication, lock fencing, or
// filesystem permissions. tmpfs cannot serve as their real-disk reference,
// even when a MOTOR job opts the other tests into its private /dev/shm mount.
// Keep reasons here, and add new filesystem-sensitive suites conservatively.
export const DISK_TEST_FILES: Readonly<Record<string, string>> = {
  'tests/core/atomic-write.test.ts':
    'Atomic replacement and secure file permissions.',
  'tests/core/common-auth-runtime.test.ts':
    'Real embedded atomic file writes and owned filesystem locks.',
  'tests/core/vault-provider-state.test.ts':
    'Real roster/state locks and refusal to publish after lock loss before rename.',
  'tests/core/vault-folder-refusal.test.ts':
    'POSIX group-writable and sticky-directory permission refusals.',
  'tests/core/vault-account-source.test.ts':
    'Conservative: lock adapter and private-mode enrollment-token fixtures.',
  'tests/core/vault-enrollment-authority.test.ts':
    'Conservative: private-mode enrollment-token corruption and restoration fixtures.',
  'tests/vault-setup.test.ts':
    'Native credential transition, enrollment locking, and POSIX permission refusal.',
  'tests/startup-order.test.ts':
    'Native credential slot transition and private-mode auth/state fixtures.',
  'tests/index.test.ts':
    'Native Google credential slot synchronization and private-mode auth/state fixtures.',
  'tests/vault-source.test.ts':
    'Mode-file refusal and private-mode dormant native-login preservation.',
  'tests/stream.test.ts':
    'Conservative: private-mode native credential fixtures.',
}
