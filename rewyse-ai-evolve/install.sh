#!/bin/bash
# Rewyse AI — Self-Improvement Agent Installer
# Adds /analyze-build, /evolve, and /evolve-help to your Claude Code project.
# Compatible with bash 3.2+ (macOS default)

set -e

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Rewyse AI — Self-Improvement Agent${NC}"
echo -e "${BLUE}  Installing add-on...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Detect project root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
INSTALL_DIR="$PROJECT_ROOT/rewyse-ai-evolve"

# Check that main Rewyse AI repo is installed
if [ ! -d "$PROJECT_ROOT/rewyse-ai" ]; then
  echo -e "${RED}[error]${NC} Rewyse AI main pipeline not found at $PROJECT_ROOT/rewyse-ai/"
  echo "        Install the main pipeline first, then run this installer."
  exit 1
fi
echo -e "${GREEN}[ok]${NC} Rewyse AI main pipeline found"

# Move to correct location if needed
if [ "$(basename "$SCRIPT_DIR")" = "rewyse-ai-evolve" ]; then
  echo -e "${GREEN}[ok]${NC} Already installed at $SCRIPT_DIR"
else
  if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}[!]${NC} rewyse-ai-evolve/ already exists at $INSTALL_DIR"
    echo "    Remove it first or install manually."
    exit 1
  fi
  mv "$SCRIPT_DIR" "$INSTALL_DIR"
  SCRIPT_DIR="$INSTALL_DIR"
  echo -e "${GREEN}[ok]${NC} Moved to $INSTALL_DIR"
fi

# Create .evolution directory in main repo
mkdir -p "$PROJECT_ROOT/rewyse-ai/.evolution/backups"
echo -e "${GREEN}[ok]${NC} Created rewyse-ai/.evolution/ directory"

# Register slash commands in .claude/skills/
SKILLS_DIR="$PROJECT_ROOT/.claude/skills"
SKILL_COUNT=0

create_skill() {
  local name="$1"
  local desc="$2"
  local arg_hint="$3"
  local body="$4"

  local skill_dir="$SKILLS_DIR/$name"
  local skill_file="$skill_dir/SKILL.md"

  if [ -f "$skill_file" ]; then
    return
  fi

  mkdir -p "$skill_dir"

  if [ -n "$arg_hint" ]; then
    printf "%s\n" "---" "name: $name" "description: $desc" "$arg_hint" "---" "" > "$skill_file"
  else
    printf "%s\n" "---" "name: $name" "description: $desc" "---" "" > "$skill_file"
  fi

  printf "%b\n" "$body" >> "$skill_file"
  SKILL_COUNT=$((SKILL_COUNT + 1))
}

create_skill "analyze-build" \
  "Analyze a completed product build and extract learnings for the self-improvement system." \
  "argument-hint: [project-slug]" \
  "Read and follow the full instructions in \`rewyse-ai-evolve/analyze-build/SKILL.md\`."

create_skill "evolve" \
  "Improve your Rewyse AI agents based on learnings from past builds. Analyzes patterns and proposes targeted updates." \
  "argument-hint: [rollback]" \
  "Read and follow the full instructions in \`rewyse-ai-evolve/evolve/SKILL.md\`.\n\nAlso read \`rewyse-ai-evolve/evolve/reference.md\` for the learning log schema and improvement patterns catalog."

create_skill "evolve-help" \
  "Get help with the self-improvement system — walkthrough, status dashboard, or troubleshooting." \
  "argument-hint: [question]" \
  "Read and follow the full instructions in \`rewyse-ai-evolve/evolve-help/SKILL.md\`.\n\nAlso read \`rewyse-ai-evolve/evolve-help/reference.md\` for FAQ and troubleshooting."

if [ "$SKILL_COUNT" -gt 0 ]; then
  echo -e "${GREEN}[ok]${NC} Registered $SKILL_COUNT new slash commands in .claude/skills/"
else
  echo -e "${GREEN}[ok]${NC} All 3 slash commands already registered"
fi

# Add registration to root CLAUDE.md
CLAUDE_MD="$PROJECT_ROOT/CLAUDE.md"
if [ -f "$CLAUDE_MD" ]; then
  if grep -q "rewyse-ai-evolve" "$CLAUDE_MD" 2>/dev/null; then
    echo -e "${GREEN}[ok]${NC} CLAUDE.md already has Self-Improvement registration"
  else
    cat >> "$CLAUDE_MD" << 'REGISTRATION'

---

### Rewyse AI — Self-Improvement Agent (`rewyse-ai-evolve/`)

See `rewyse-ai-evolve/CLAUDE.md` for full documentation.

**Commands:**
- `/analyze-build {slug}` — Extract learnings from a completed build
- `/evolve` — Apply improvements based on all analyzed builds
- `/evolve rollback` — Undo the last evolution
- `/evolve-help` — Walkthrough, status, and troubleshooting
REGISTRATION
    echo -e "${GREEN}[ok]${NC} Added Self-Improvement registration to CLAUDE.md"
  fi
fi

# Add /analyze-build suggestion to main pipeline's build-product Next Steps
BUILD_PRODUCT="$PROJECT_ROOT/rewyse-ai/build-product/SKILL.md"
if [ -f "$BUILD_PRODUCT" ]; then
  if grep -q "analyze-build" "$BUILD_PRODUCT" 2>/dev/null; then
    echo -e "${GREEN}[ok]${NC} /analyze-build already suggested in build-product"
  else
    # Add suggestion line after the existing Next Steps entries
    if grep -q "product-qa" "$BUILD_PRODUCT" 2>/dev/null; then
      sed -i '' '/Run.*product-qa.*anytime/a\
> - Run `/analyze-build {slug}` to feed the self-improvement system' "$BUILD_PRODUCT" 2>/dev/null || true
      echo -e "${GREEN}[ok]${NC} Added /analyze-build suggestion to build-product Next Steps"
    fi
  fi
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Self-Improvement Agent installed!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  How to use:"
echo ""
echo "  1. Build a product with /build-product (as normal)"
echo "  2. Run /analyze-build {slug} after each completed build"
echo "  3. After 2+ analyzed builds, run /evolve to improve your agents"
echo ""
echo "  Need help? Run /evolve-help anytime."
echo ""
