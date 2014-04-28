# npmd-cache

A robust cache for modules that supports offline install.

`npmd-cache` has two parts, a immutable content addressable store,
which is used to persist the tarballs (the packages themselves)
and a mutable database which is used to persist the mappings from
various module identifiers (module@version, http or git urls) to the hash of the tarball.

When a module is requested by a url, if that module is not currently known,
it will be downloaded from the registry or github, or wherever the url points.

npmd-cache can also resolve modules that are referenced by their url or their _shasum_.
(however, npmd can only install a module referenced by it's shasum if it's in your cache,
so do not put shasums in your package.json)

## License

MIT
