"""Fail-closed Linux seccomp boundary for the dormant form inspector.

The filter permits only AF_UNIX stream/seqpacket sockets for browser IPC,
denies connect(), and rejects datagram sockets/pairs that could address a
named host relay. The worker and all Chromium descendants inherit it.
"""
import ctypes
import errno
import importlib.metadata
import os
import platform
import shutil
import subprocess
import sys


_PR_SET_SECCOMP = 22
_PR_GET_SECCOMP = 21
_PR_SET_NO_NEW_PRIVS = 38
_PR_GET_NO_NEW_PRIVS = 39
_SECCOMP_MODE_FILTER = 2
_SECCOMP_RET_KILL_PROCESS = 0x80000000
_SECCOMP_RET_ERRNO = 0x00050000
_SECCOMP_RET_ALLOW = 0x7FFF0000
_BPF_LD_W_ABS = 0x20
_BPF_JMP_JEQ_K = 0x15
_BPF_RET_K = 0x06
_BPF_ALU_AND_K = 0x54
_SECCOMP_DATA_ARCH = 4
_SECCOMP_DATA_NR = 0
_SECCOMP_DATA_ARG0 = 16
_SECCOMP_DATA_ARG1 = 24
_AF_UNIX = 1
INSPECTION_PYTHON_VERSION = (3, 13, 11)
INSPECTION_PLAYWRIGHT_VERSION = "1.63.0"
INSPECTION_CHROMIUM_VERSION = "138.0.7204.100"


class _SockFilter(ctypes.Structure):
    _fields_ = [("code", ctypes.c_ushort), ("jt", ctypes.c_ubyte),
                ("jf", ctypes.c_ubyte), ("k", ctypes.c_uint)]


class _SockFprog(ctypes.Structure):
    _fields_ = [("len", ctypes.c_ushort),
                ("filter", ctypes.POINTER(_SockFilter))]


def _platform_spec():
    machine = platform.machine().lower()
    if machine in ("x86_64", "amd64"):
        return 0xC000003E, 41, 53, 425, 42  # AUDIT_ARCH_X86_64
    if machine in ("aarch64", "arm64"):
        return 0xC00000B7, 198, 199, 425, 203  # AUDIT_ARCH_AARCH64
    raise RuntimeError("INSPECTION_NETWORK_SANDBOX_UNSUPPORTED_ARCH")


def _filter_program():
    arch, socket_syscall, socketpair_syscall, io_uring_setup, connect_syscall = _platform_spec()
    instructions = [
        _SockFilter(_BPF_LD_W_ABS, 0, 0, _SECCOMP_DATA_ARCH),
        _SockFilter(_BPF_JMP_JEQ_K, 1, 0, arch),
        _SockFilter(_BPF_RET_K, 0, 0, _SECCOMP_RET_KILL_PROCESS),
        _SockFilter(_BPF_LD_W_ABS, 0, 0, _SECCOMP_DATA_NR),
    ]

    # io_uring can create sockets from its submission queue without a socket()
    # syscall, so it must be unavailable to this process tree.
    for syscall_number in (io_uring_setup, connect_syscall):
        instructions.extend([
            _SockFilter(_BPF_JMP_JEQ_K, 0, 1, syscall_number),
            _SockFilter(_BPF_RET_K, 0, 0, _SECCOMP_RET_ERRNO | errno.EPERM),
        ])

    # Chromium's profile singleton requires a local stream listener. Allow only
    # AF_UNIX streams/seqpackets; connect() is denied above. Datagram sockets
    # and pairs can sendmsg() to a named host socket without connect().
    # On 32-bit x86, socketcall multiplexes all socket operations.
    machine = platform.machine().lower()
    if machine in ("i386", "i486", "i586", "i686", "x86"):
        raise RuntimeError("INSPECTION_NETWORK_SANDBOX_UNSUPPORTED_ARCH")

    # The syscall numbers are known for the two architectures above.
    for syscall_number in (socket_syscall, socketpair_syscall):
        instructions.extend([
            _SockFilter(_BPF_JMP_JEQ_K, 0, 9, syscall_number),
            _SockFilter(_BPF_LD_W_ABS, 0, 0, _SECCOMP_DATA_ARG0),
            _SockFilter(_BPF_JMP_JEQ_K, 1, 0, _AF_UNIX),
            _SockFilter(_BPF_RET_K, 0, 0, _SECCOMP_RET_ERRNO | errno.EPERM),
            _SockFilter(_BPF_LD_W_ABS, 0, 0, _SECCOMP_DATA_ARG1),
            _SockFilter(_BPF_ALU_AND_K, 0, 0, 0xF),
            _SockFilter(_BPF_JMP_JEQ_K, 2, 0, 1),  # SOCK_STREAM
            _SockFilter(_BPF_JMP_JEQ_K, 1, 0, 5),  # SOCK_SEQPACKET
            _SockFilter(_BPF_RET_K, 0, 0, _SECCOMP_RET_ERRNO | errno.EPERM),
            _SockFilter(_BPF_RET_K, 0, 0, _SECCOMP_RET_ALLOW),
        ])
    instructions.append(_SockFilter(_BPF_RET_K, 0, 0, _SECCOMP_RET_ALLOW))
    array_type = _SockFilter * len(instructions)
    return array_type(*instructions)


def verify_inspection_runtime(chromium_path=None):
    """Reject unreviewed interpreter, Playwright, or browser binaries."""
    if sys.version_info[:3] != INSPECTION_PYTHON_VERSION:
        raise RuntimeError("INSPECTION_RUNTIME_MISMATCH")
    try:
        playwright_version = importlib.metadata.version("playwright")
    except importlib.metadata.PackageNotFoundError as error:
        raise RuntimeError("INSPECTION_RUNTIME_MISMATCH") from error
    browser = chromium_path or shutil.which("chromium")
    if playwright_version != INSPECTION_PLAYWRIGHT_VERSION or not browser:
        raise RuntimeError("INSPECTION_RUNTIME_MISMATCH")
    try:
        result = subprocess.run([browser, "--version"], check=True, capture_output=True,
                                text=True, timeout=5)
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError("INSPECTION_RUNTIME_MISMATCH") from error
    if result.stdout.strip() != f"Chromium {INSPECTION_CHROMIUM_VERSION}":
        raise RuntimeError("INSPECTION_RUNTIME_MISMATCH")


def _close_inherited_descriptors():
    try:
        descriptors = os.listdir("/proc/self/fd")
    except OSError as error:
        raise RuntimeError("INSPECTION_NETWORK_SANDBOX_FD_CHECK_FAILED") from error
    for raw_fd in descriptors:
        try:
            fd = int(raw_fd)
        except ValueError:
            continue
        if fd > 2:
            try:
                os.close(fd)
            except OSError:
                pass


def install_default_deny():
    """Install a non-removable filter; raise instead of continuing on failure."""
    if not sys.platform.startswith("linux"):
        raise RuntimeError("INSPECTION_NETWORK_SANDBOX_UNSUPPORTED_OS")
    instructions = _filter_program()
    program = _SockFprog(len(instructions), instructions)
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(_PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "PR_SET_NO_NEW_PRIVS failed")
    if libc.prctl(_PR_SET_SECCOMP, _SECCOMP_MODE_FILTER,
                  ctypes.byref(program), 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "PR_SET_SECCOMP failed")
    require_default_deny_active()


def require_default_deny_active():
    """Verify kernel state before any inspection browser may be launched."""
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(_PR_GET_SECCOMP, 0, 0, 0, 0) != _SECCOMP_MODE_FILTER:
        raise RuntimeError("INSPECTION_NETWORK_SANDBOX_NOT_ACTIVE")
    if libc.prctl(_PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) != 1:
        raise RuntimeError("INSPECTION_NETWORK_SANDBOX_NOT_ACTIVE")


def _clean_proxy_environment():
    for key in tuple(os.environ):
        if key.lower() in {
            "http_proxy", "https_proxy", "all_proxy", "no_proxy",
            "ftp_proxy", "ws_proxy", "wss_proxy", "socks_proxy",
        }:
            os.environ.pop(key, None)


def main():
    arguments = sys.argv[1:]
    if arguments and arguments[0] == "--":
        arguments = arguments[1:]
    if not arguments:
        raise RuntimeError("INSPECTION_NETWORK_SANDBOX_TARGET_REQUIRED")

    _close_inherited_descriptors()
    _clean_proxy_environment()
    install_default_deny()
    verify_inspection_runtime()
    target = os.path.abspath(arguments[0])
    os.execv(sys.executable, [sys.executable, "-u", target, *arguments[1:]])


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error) or type(error).__name__, file=sys.stderr, flush=True)
        sys.exit(125)
