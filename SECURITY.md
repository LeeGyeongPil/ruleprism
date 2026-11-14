# 보안 정책 / Security policy

보안 취약점을 발견하셨다면 **공개 이슈 대신** 이 레포의 **Security → Report a vulnerability**(비공개 취약점 신고)로 알려 주세요. 확인 후 답변드리고, 고친 버전을 릴리스하면서 함께 안내합니다.

If you find a security issue, please **do not open a public issue**. Use **Security → Report a vulnerability** in this repository to report it privately. We will reply after checking and announce the fix with a release.

이 확장과 CLI 는 작업 공간의 파일(켜면 몇몇 사용자 수준 경로)만 읽습니다. 네트워크 접속·서버·자식 프로세스가 없습니다. / The extension and CLI only read files in your workspace (and a few user-level paths when enabled). They make no network connections, run no server and start no child processes.
