# Task 20 Reference Documentation: Homebrew Formula Patterns

**Task Scope**: Local formula generation with `on_arm`/`on_intel` URL+sha blocks, local tap creation, `brew audit --strict`, `brew install --build-from-source`, and `brew test` patterns.

## Official Homebrew Documentation

### Primary Documentation Sources

1. **Main Documentation Site**
   - URL: https://docs.brew.sh/
   - Sitemap: https://docs.brew.sh/sitemap.xml
   - Last updated: 2026-03-10 (current)
   
2. **Formula Cookbook** (Authoritative Guide)
   - URL: https://docs.brew.sh/Formula-Cookbook
   - Covers: Formula structure, dependencies, testing, patches, advanced patterns
   - Key sections for Atlas:
     - "Add a test to the formula"
     - "Audit the formula"
     - "Install the formula"
     - "Handling different system configurations"

3. **How to Create and Maintain a Tap**
   - URL: https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap
   - Covers: Local tap creation, formula placement, best practices
   - Key pattern: `brew tap-new $YOUR_GITHUB_USERNAME/homebrew-tap`

4. **Manpage** (Command Reference)
   - URL: https://docs.brew.sh/Manpage
   - Covers: All brew commands, options, environment variables
   - Key commands for Atlas:
     - `brew install --build-from-source`
     - `brew audit --strict`
     - `brew test`

---

## on_arm / on_intel Blocks

### Official Support

**PR #13451** (Merged June 29, 2022)
- URL: https://github.com/Homebrew/brew/pull/13451
- Title: "Add `on_{system}` blocks to formula and cask DSL"
- Author: @Rylan12 (Homebrew maintainer)
- Status: **Merged** - Official feature since Homebrew 3.5+

**PR #13539** (Merged July 25, 2022)
- URL: https://github.com/Homebrew/brew/pull/13539
- Title: "Add `on_system` to and reorder component order cop"
- Establishes canonical ordering:
  1. `on_macos`, `on_ventura`, `on_monterey`, etc.
  2. `on_system :linux, macos:`
  3. `on_linux`
  4. `on_arm`
  5. `on_intel`

### Syntax Pattern (from PR #13451 example)

```ruby
class MyTool < Formula
  desc "Tool description"
  homepage "https://example.com"
  version "1.0.0"
  license "MIT"

  # Default values (for ARM/Apple Silicon)
  url "https://example.com/mytool-#{version}-arm64.tar.gz"
  sha256 "arm64-sha256-hash-here"

  # Intel-specific overrides
  on_intel do
    url "https://example.com/mytool-#{version}-x86_64.tar.gz"
    sha256 "intel-sha256-hash-here"
  end

  # Can nest OS + arch conditions
  on_linux do
    on_arm do
      url "https://example.com/mytool-#{version}-linux-arm64.tar.gz"
      sha256 "linux-arm64-sha256-hash-here"
    end
    
    on_intel do
      url "https://example.com/mytool-#{version}-linux-x64.tar.gz"
      sha256 "linux-x64-sha256-hash-here"
    end
  end

  def install
    bin.install "mytool"
  end

  test do
    assert_match "version #{version}", shell_output("#{bin}/mytool --version")
  end
end
```

### Real-World Examples from homebrew-core

**Example 1: openjdk.rb** (Multiple OS + arch combinations)
```ruby
on_macos do
  on_arm do
    url "https://download.java.net/java/GA/jdk25.0.1/.../openjdk-25.0.1_macos-aarch64_bin.tar.gz"
    sha256 "..."
  end
  on_intel do
    url "https://download.java.net/java/GA/jdk25.0.1/.../openjdk-25.0.1_macos-x64_bin.tar.gz"
    sha256 "..."
  end
end
on_linux do
  on_arm do
    url "https://download.java.net/java/GA/jdk25.0.1/.../openjdk-25.0.1_linux-aarch64_bin.tar.gz"
    sha256 "..."
  end
  on_intel do
    url "https://download.java.net/java/GA/jdk25.0.1/.../openjdk-25.0.1_linux-x64_bin.tar.gz"
    sha256 "..."
  end
end
```

**Example 2: ghc.rb** (Build-time workarounds)
```ruby
on_arm do
  # Work around build failure with Ubuntu 22.04 toolchain
  # [Comment explaining patch reason]
  url "https://downloads.haskell.org/~ghc/9.12.2/ghc-9.12.2-aarch64-apple-darwin.tar.xz"
  sha256 "..."
end

on_intel do
  url "https://downloads.haskell.org/~ghc/9.12.2/ghc-9.12.2-x86_64-apple-darwin.tar.xz"
  sha256 "..."
end
```

### Key Behaviors

1. **Default values outside blocks** apply to all systems not explicitly overridden
2. **Blocks can nest** (e.g., `on_linux { on_arm { ... } }`)
3. **Order matters** for style compliance (see PR #13539 ordering)
4. **Any stanza can appear inside** `on_arm`/`on_intel`: `url`, `sha256`, `depends_on`, `patch`, etc.
5. **Variations are resolved at install time** based on current system

---

## Local Tap Creation

### Official Documentation

**Source**: https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap

### Creation Command

```bash
brew tap-new $YOUR_GITHUB_USERNAME/homebrew-tap
```

This creates:
```
/opt/homebrew/Library/Taps/$YOUR_GITHUB_USERNAME/homebrew-tap/
├── .github/
│   └── workflows/
│       ├── publish.yml (bottles to GitHub Releases)
│       └── tests.yml (CI testing)
├── Formula/
├── Casks/
└── README.md
```

### Directory Structure Options

Formulae can live in three locations (first available wins):
1. `Formula/` subdirectory (recommended)
2. `HomebrewFormula/` subdirectory
3. Repository root (discouraged - mixes with other files)

**Recommendation**: Use `Formula/` for clean organization.

### Adding a Formula to Local Tap

```bash
# Create formula from tarball URL
brew create https://example.com/mytool-1.0.0.tar.gz \
  --tap $YOUR_GITHUB_USERNAME/homebrew-tap \
  --set-name mytool

# Edit the formula
brew edit $YOUR_GITHUB_USERNAME/homebrew-tap/mytool

# Test locally
brew install --build-from-source $YOUR_GITHUB_USERNAME/homebrew-tap/mytool
brew test $YOUR_GITHUB_USERNAME/homebrew-tap/mytool
brew audit --strict $YOUR_GITHUB_USERNAME/homebrew-tap/mytool
```

### Installing from Local Tap

**Option 1: Direct install (recommended)**
```bash
brew install user/repo/formula
# Homebrew auto-taps before installing
```

**Option 2: Manual tap + install**
```bash
brew tap user/repo
brew install formula
```

### Local-Only Tap (No GitHub)

```bash
# Create tap directory manually
mkdir -p $(brew --repository)/Taps/myuser/homebrew-local

# Add formula
cp mytool.rb $(brew --repository)/Taps/myuser/homebrew-local/Formula/

# Install
brew tap myuser/homebrew-local
brew install mytool
```

### Naming Conflicts

If formula name conflicts with core tap:
1. **Rename formula** (e.g., `nginx-full` for extended nginx)
2. **Use fully-qualified name** when installing: `brew install user/repo/formula`
3. **Make keg-only** to avoid link conflicts

---

## brew audit --strict

### Official Documentation

**Source**: https://docs.brew.sh/Formula-Cookbook#audit-the-formula

### Command

```bash
brew audit --strict --online mytool
```

### What It Checks

1. **Style compliance** (Ruby style guide + Homebrew conventions)
2. **Trailing whitespace**
3. **URL format** (preferred hosts, version extraction)
4. **Checksum correctness**
5. **License validity** (SPDX identifiers)
6. **Homepage accessibility**
7. **Dependency declarations**
8. **Test presence and validity**
9. **Caveats formatting**
10. **Version scheme consistency**

### New Formula Requirements

For new formula submissions to homebrew-core:

```bash
brew audit --new --formula mytool
```

Additional checks:
- Meets [Acceptable Formulae](https://docs.brew.sh/Acceptable-Formulae) requirements
- Not a duplicate of existing formula
- Has stable, tagged version (not just git repo)
- Still supported by upstream
- No extensive patching required

### Common Audit Failures

1. **Missing homepage** - Every formula MUST have `homepage`
2. **Missing license** - Every formula MUST have `license` (SPDX format)
3. **No test block** - Every formula SHOULD have a `test do` block
4. **Invalid URL** - Must point to stable release tarball
5. **Wrong checksum** - SHA-256 must match downloaded file

### Fixing Audit Issues

```bash
# Check specific formula
brew audit --strict mytool

# Auto-fix some issues (not all)
brew style --fix mytool

# Manual fixes require editing formula
brew edit mytool
```

---

## brew install --build-from-source

### Official Documentation

**Source**: https://docs.brew.sh/Manpage (install command)

### Command

```bash
# Build from source even if bottle exists
brew install --build-from-source mytool

# Short form
brew install -s mytool
```

### Behavior

1. **Ignores bottles** (pre-built binaries)
2. **Downloads source tarball** from `url`
3. **Verifies SHA-256** checksum
4. **Extracts to temporary sandbox**
5. **Runs build steps** (`./configure`, `make`, etc.)
6. **Installs to Cellar** (`/opt/homebrew/Cellar/mytool/1.0.0`)
7. **Symlinks to prefix** (`/opt/homebrew/bin/mytool`)

### Related Options

```bash
# Interactive debug mode on failure
brew install --build-from-source --debug --verbose mytool

# Keep temporary build files
brew install --build-from-source --keep-tmp mytool

# Build for eventual bottling
brew install --build-bottle mytool

# Skip post-install steps
brew install --skip-post-install mytool
```

### When to Use

1. **No bottle available** for your macOS version/arch
2. **Testing new formula** before bottling
3. **Debugging build issues**
4. **Custom compilation flags** (via `--cc` option)

### Dependency Handling

```bash
# Dependencies still use bottles if available
brew install --build-from-source mytool
# → Dependencies: bottles (fast)
# → Formula: source build (slow)

# Force ALL dependencies to build from source (rare)
brew install --ignore-dependencies --build-from-source mytool
```

---

## brew test

### Official Documentation

**Source**: https://docs.brew.sh/Formula-Cookbook#add-a-test-to-the-formula

### Command

```bash
# Run test for installed formula
brew test mytool

# Test specific version
brew test mytool@1.0
```

### Test Block Syntax

```ruby
class MyTool < Formula
  # ... formula definition ...

  test do
    # testpath is a temporary directory (auto-created, auto-deleted)
    # HOME is set to testpath
    
    # Good test: exercises real functionality
    system bin/"mytool", "build", "input.txt"
    assert_path_exists testpath/"output.txt"
    
    # Bad test: only checks version/help
    # assert_match "version", shell_output("#{bin}/mytool --version")
    
    # Use standard test fixtures if needed
    # test_fixtures("test.svg")
  end
end
```

### Test Best Practices

1. **Test real functionality**, not just `--version` or `--help`
2. **Write input files** to `testpath` for tools that process files
3. **Use assertions** from `Minitest`:
   - `assert_match` - regex match on output
   - `assert_equal` - exact string/value match
   - `assert_path_exists` - file existence
   - `shell_output` - capture command output

4. **For libraries**: compile and run a small program that links
5. **For GUI apps**: find CLI-accessible functionality
6. **For network tools**: try connection with invalid credentials

### Test Examples

**CLI tool with input/output:**
```ruby
test do
  (testpath/"input.txt").write("test data")
  system bin/"mytool", "process", testpath/"input.txt"
  assert_equal "processed: test data", (testpath/"output.txt").read
end
```

**Library with C bindings:**
```ruby
test do
  (testpath/"test.c").write <<~EOS
    #include <mylib.h>
    int main() {
      return mylib_init() == 0 ? 0 : 1;
    }
  EOS
  system ENV.cc, "test.c", "-L#{lib}", "-lmylib", "-o", "test"
  system "./test"
end
```

**Tool requiring test fixture:**
```ruby
test do
  resource "testdata" do
    url "https://example.com/test-input.dat"
    sha256 "..."
  end
  
  resource("testdata").stage do
    system bin/"mytool", "validate", "test-input.dat"
  end
end
```

### CI Integration

Homebrew CI automatically runs `brew test` for:
- New formula PRs
- Version bumps
- Dependency updates

**Local CI workflow:**
```bash
# Full validation loop
brew install --build-from-source mytool
brew test mytool
brew audit --strict mytool
```

---

## Applicability to Atlas (Task 20)

### Required Patterns

1. **on_arm / on_intel blocks** for architecture-specific binaries
   - Default: ARM/Apple Silicon URL + SHA
   - Override: Intel URL + SHA in `on_intel` block
   - Optional: Linux + ARM combinations if targeting cross-platform

2. **Local tap creation** for development/testing
   - Use `brew tap-new` or manual directory creation
   - Place formula in `Formula/` subdirectory
   - Test with `--build-from-source` before publishing

3. **Audit compliance** for quality gate
   - Run `brew audit --strict --online` before release
   - Ensure license, homepage, test block present
   - Fix all style violations

4. **Build-from-source testing** for validation
   - Always test install with `--build-from-source`
   - Verify all dependencies resolve correctly
   - Check binary runs on target architecture

5. **Functional test block** for automated verification
   - Test real functionality (not just version flags)
   - Use temporary `testpath` for file operations
   - Assert expected outputs/behaviors

### Local-First Implementation (Remote Gating)

**What Atlas can implement immediately:**
- Generate formula Ruby code with `on_arm`/`on_intel` blocks
- Create local tap structure (`Formula/` directory)
- Write formula file with correct syntax
- Run `brew audit --strict` locally for validation
- Test `brew install --build-from-source` locally
- Run `brew test` locally

**What requires remote tap:**
- Publishing to GitHub tap repository
- Distributing via `brew install user/repo/formula`
- Hosting bottles on GitHub Releases
- CI/CD for automated testing

**Recommendation**: Implement full local formula generation + testing first, gate remote publication behind configuration flag.

---

## Summary: Direct URLs for Atlas Implementation

**Official Documentation:**
- Main: https://docs.brew.sh/
- Formula Cookbook: https://docs.brew.sh/Formula-Cookbook
- Tap Creation: https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap
- Manpage: https://docs.brew.sh/Manpage

**Key PRs (Evidence):**
- on_system blocks: https://github.com/Homebrew/brew/pull/13451
- Component ordering: https://github.com/Homebrew/brew/pull/13539

**Real-World Examples:**
- openjdk.rb: Multiple OS + arch combinations
- ghc.rb: Build-time workarounds with patches
- Search more: `gh search code "on_arm do" --repo Homebrew/homebrew-core --language Ruby`

**Testing Commands:**
```bash
brew tap-new user/homebrew-tap
brew install --build-from-source formula
brew test formula
brew audit --strict --online formula
```

---

**Generated**: 2026-03-10
**Task**: 20 - Homebrew formula generation
**Status**: Ready for implementation
