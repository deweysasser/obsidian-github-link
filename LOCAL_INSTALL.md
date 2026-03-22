# Local Install

Install the GitHub Link plugin manually by building with Docker and copying the output into your Obsidian vault.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Make](https://www.gnu.org/software/make/)
- An existing Obsidian vault

## Steps

1. **Clone the repository:**

   ```bash
   git clone https://github.com/nathonius/obsidian-github-link.git
   cd obsidian-github-link
   ```

2. **Build the plugin:**

   ```bash
   make
   ```

   This compiles the plugin inside a Docker container and writes `main.js`, `manifest.json`, and `styles.css` to the `./build` directory.

3. **Copy the build output into your vault:**

   ```bash
   mkdir -p /path/to/your-vault/.obsidian/plugins/github-link
   cp ./build/* /path/to/your-vault/.obsidian/plugins/github-link/
   ```

4. **Enable the plugin:**

   Open Obsidian, go to **Settings > Community plugins**, and enable **GitHub Link**.

## Updating

Pull the latest changes, rebuild, and copy again:

```bash
git pull
make
cp ./build/* /path/to/your-vault/.obsidian/plugins/github-link/
```

To remove build artifacts, run `make clean`.

Restart Obsidian or reload the plugin from **Settings > Community plugins**.

## Development

If you have Node.js installed locally and prefer a faster feedback loop:

```bash
npm install
npm run dev
```

Then symlink the project into your vault's plugin directory instead of copying:

```bash
ln -s /path/to/obsidian-github-link /path/to/your-vault/.obsidian/plugins/github-link
```
