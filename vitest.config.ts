import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // CLI 테스트는 빌드된 out/cli/main.js 를 자식 프로세스로 여러 번 돌린다.
    // 공유 CI 기계(GitHub Actions)는 로컬보다 느릴 수 있어 상한을 넉넉히 둔다(test/helpers.ts 의 CHILD_TIMEOUT_MS 보다 크게).
    testTimeout: 120000,
    hookTimeout: 60000,
  },
});
