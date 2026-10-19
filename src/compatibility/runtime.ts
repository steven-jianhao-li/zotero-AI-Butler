import "core-js/stable";
import ResizeObserver from "resize-observer-polyfill";

const scope = globalThis as any;

if (scope.document && !scope.ResizeObserver)
  scope.ResizeObserver = ResizeObserver;

if (!scope.IOUtils && scope.OS) {
  const { File, Path } = scope.OS;
  scope.PathUtils = {
    join: (...segments: string[]) => Path.join(...segments),
    parent: (path: string) => Path.dirname(path),
    filename: (path: string) => Path.basename(path),
  };
  scope.IOUtils = {
    exists: (path: string) => File.exists(path),
    read: (path: string) => File.read(path),
    readUTF8: (path: string) => File.read(path, { encoding: "utf-8" }),
    write: (path: string, bytes: Uint8Array, options = {}) =>
      File.writeAtomic(path, bytes, options),
    writeUTF8: (path: string, text: string, options = {}) =>
      File.writeAtomic(path, text, { ...options, encoding: "utf-8" }),
    copy: (source: string, destination: string, options = {}) =>
      File.copy(source, destination, options),
    remove: (path: string, options: { ignoreAbsent?: boolean } = {}) =>
      File.remove(path, { ignoreAbsent: options.ignoreAbsent !== false }),
    stat: async (path: string) => {
      const stat = await File.stat(path);
      return {
        size: stat.size,
        type: stat.isDir ? "directory" : "regular",
        lastModified: stat.lastModificationDate.getTime(),
      };
    },
    makeDirectory: async (
      path: string,
      options: { createAncestors?: boolean; ignoreExisting?: boolean } = {},
    ) => {
      const missing = [path];
      if (options.createAncestors !== false) {
        let parent = Path.dirname(path);
        while (!(await File.exists(parent))) {
          missing.push(parent);
          const ancestor = Path.dirname(parent);
          if (ancestor === parent)
            throw new Error(`Cannot find an existing ancestor of ${path}`);
          parent = ancestor;
        }
      }
      for (const directory of missing.reverse()) {
        await File.makeDir(directory, {
          ignoreExisting:
            options.ignoreExisting !== false || directory !== path,
        });
      }
    },
    getChildren: async (path: string) => {
      const iterator = new File.DirectoryIterator(path);
      try {
        return (await iterator.nextBatch()).map(
          (entry: { path: string }) => entry.path,
        );
      } finally {
        await iterator.close();
      }
    },
  };
}
