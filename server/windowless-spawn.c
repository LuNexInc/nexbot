// windowless-spawn.exe — run a console CLI under a HIDDEN console so its own
// console children attach to that hidden console instead of allocating new
// visible consoles (the NexBot "console flash"). stdio is passed through so
// the parent still reads the child's stdout/stderr over its pipes.
//
// Usage: windowless-spawn.exe <command> [args...]
// The first arg is the program to run; the rest are its args. Every arg is
// quoted and the whole thing becomes a single command line for CreateProcess.
#define _WIN32_WINNT 0x0600
#include <windows.h>
#include <wchar.h>
#include <stdlib.h>

static wchar_t* quote_join(int argc, wchar_t* argv[]) {
  size_t cap = 4096, len = 0;
  wchar_t* cmd = (wchar_t*)malloc(cap * sizeof(wchar_t));
  if (!cmd) return NULL;
  cmd[0] = L'\0';
  for (int i = 1; i < argc; i++) {
    size_t arglen = wcslen(argv[i]);
    // quote + surrounding quotes + space
    size_t need = arglen + 3;
    while (len + need + 1 >= cap) { cap *= 2; cmd = (wchar_t*)realloc(cmd, cap * sizeof(wchar_t)); if (!cmd) return NULL; }
    cmd[len++] = L'"';
    memcpy(cmd + len, argv[i], arglen * sizeof(wchar_t));
    len += arglen;
    cmd[len++] = L'"';
    if (i < argc - 1) cmd[len++] = L' ';
    cmd[len] = L'\0';
  }
  return cmd;
}

int wmain(int argc, wchar_t* argv[]) {
  if (argc < 2) return 1;
  wchar_t* cmdline = quote_join(argc, argv);
  if (!cmdline) return 3;

  STARTUPINFOW si;
  PROCESS_INFORMATION pi;
  ZeroMemory(&si, sizeof(si));
  si.cb = sizeof(si);
  // Pass our stdio handles through, and ask the new console window to be hidden.
  si.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
  si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  si.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  si.wShowWindow = SW_HIDE;

  // CREATE_NEW_CONSOLE gives the child a console (so ITS children attach to
  // it); STARTF_USESHOWWINDOW + SW_HIDE makes that console window invisible.
  if (!CreateProcessW(NULL, cmdline, NULL, NULL, TRUE, CREATE_NEW_CONSOLE, NULL, NULL, &si, &pi)) {
    free(cmdline);
    return 2;
  }
  WaitForSingleObject(pi.hProcess, INFINITE);
  DWORD code = 0;
  GetExitCodeProcess(pi.hProcess, &code);
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  free(cmdline);
  return (int)code;
}
