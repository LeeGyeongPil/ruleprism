import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // CLI 테스트는 빌드된 out/cli/main.js 를 자식 프로세스로 돌리므로 넉넉히 둔다.
    testTimeout: 30000,
  },
});
