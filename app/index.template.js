// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { {{ appClassName }} } from '{{ appModuleName }}';

import { JupyterLiteServer } from '@jupyterlite/server';

// The webpack public path needs to be set before loading the CSS assets.
import { PageConfig } from '@jupyterlab/coreutils';

import './style.js';

const serverExtensions = [
  import('@jupyterlite/server-extension')
];

// custom list of disabled plugins
const disabled = [
{{#each disabledExtensions}}
  "{{this}}",
{{/each}}
];

async function createModule(scope, module) {
  try {
    const factory = await window._JUPYTERLAB[scope].get(module);
    const instance = factory();
    instance.__scope__ = scope;
    return instance;
  } catch (e) {
    console.warn(`Failed to create module: package: ${scope}; module: ${module}`);
    throw e;
  }
}

/**
 * The main entry point for the application.
 */
export async function main() {
  const allPlugins = [];
  const pluginsToRegister = [];
  const federatedExtensionPromises = [];
  const federatedMimeExtensionPromises = [];
  const federatedStylePromises = [];
  const litePluginsToRegister = [];
  const liteExtensionPromises = [];

  // This is all the data needed to load and activate plugins. This should be
  // gathered by the server and put onto the initial page template.
  const extensions = JSON.parse(
    PageConfig.getOption('federated_extensions')
  );

  // The set of federated extension names.
  const federatedExtensionNames = new Set();

  extensions.forEach(data => {
    if (data.liteExtension) {
      liteExtensionPromises.push(createModule(data.name, data.extension));
      return;
    }
    if (data.extension) {
      federatedExtensionNames.add(data.name);
      federatedExtensionPromises.push(createModule(data.name, data.extension));
    }
    if (data.mimeExtension) {
      federatedExtensionNames.add(data.name);
      federatedMimeExtensionPromises.push(createModule(data.name, data.mimeExtension));
    }
    if (data.style) {
      federatedStylePromises.push(createModule(data.name, data.style));
    }
  });

  /**
   * Iterate over active plugins in an extension.
   */
  function* activePlugins(extension) {
    // Handle commonjs or es2015 modules
    let exports;
    if (extension.hasOwnProperty('__esModule')) {
      exports = extension.default;
    } else {
      // CommonJS exports.
      exports = extension;
    }

    let plugins = Array.isArray(exports) ? exports : [exports];
    for (let plugin of plugins) {
      if (
        PageConfig.Extension.isDisabled(plugin.id) ||
        disabled.includes(plugin.id) ||
        disabled.includes(plugin.id.split(':')[0])
      ) {
        continue;
      }
      allPlugins.push({
        ...plugin,
        extension: extension.__scope__
      });
      yield plugin;
    }
  }

  // Handle the mime extensions.
  const mimeExtensions = [];
  {{#each mimeExtensions}}
  if (!federatedExtensionNames.has('{{@key}}')) {
    try {
      let ext = require('{{@key}}{{#if this}}/{{this}}{{/if}}');
      ext.__scope__ = '{{@key}}';
      for (let plugin of activePlugins(ext)) {
        mimeExtensions.push(plugin);
      }
    } catch (e) {
      console.error(e);
    }
  }
  {{/each}}

  // Add the federated mime extensions.
  const federatedMimeExtensions = await Promise.allSettled(federatedMimeExtensionPromises);
  federatedMimeExtensions.forEach(p => {
    if (p.status === "fulfilled") {
      for (let plugin of activePlugins(p.value)) {
        mimeExtensions.push(plugin);
      }
    } else {
      console.error(p.reason);
    }
  });

  // Handle the standard extensions.
  {{#each extensions}}
  if (!federatedExtensionNames.has('{{@key}}')) {
    try {
      let ext = require('{{@key}}{{#if this}}/{{this}}{{/if}}');
      ext.__scope__ = '{{@key}}';
      for (let plugin of activePlugins(ext)) {
        pluginsToRegister.push(plugin);
      }
    } catch (e) {
      console.error(e);
    }
  }
  {{/each}}

  // Add the federated extensions.
  const federatedExtensions = await Promise.allSettled(federatedExtensionPromises);
  federatedExtensions.forEach(p => {
    if (p.status === "fulfilled") {
      for (let plugin of activePlugins(p.value)) {
        pluginsToRegister.push(plugin);
      }
    } else {
      console.error(p.reason);
    }
  });

  // Add the base serverlite extensions
  const baseServerExtensions = await Promise.all(serverExtensions);
  baseServerExtensions.forEach(p => {
    for (let plugin of activePlugins(p)) {
      litePluginsToRegister.push(plugin);
    }
  })

  // Add the serverlite federated extensions.
  const federatedLiteExtensions = await Promise.allSettled(liteExtensionPromises);
  federatedLiteExtensions.forEach(p => {
    if (p.status === "fulfilled") {
      for (let plugin of activePlugins(p.value)) {
        litePluginsToRegister.push(plugin);
      }
    } else {
      console.error(p.reason);
    }
  });

  // Load all federated component styles and log errors for any that do not
  (await Promise.allSettled(federatedStylePromises)).filter(({status}) => status === "rejected").forEach(({reason}) => {
     console.error(reason);
    });

  // create the in-browser JupyterLite Server
  const jupyterLiteServer = new JupyterLiteServer({});
  jupyterLiteServer.registerPluginModules(litePluginsToRegister);
  // start the server
  await jupyterLiteServer.start();

  // retrieve the custom service manager from the server app
  const { serviceManager } = jupyterLiteServer;

  // create a full-blown JupyterLab frontend
  const app = new {{ appClassName }}({
    mimeExtensions,
    serviceManager,
    availablePlugins: allPlugins
  });
  app.name = PageConfig.getOption('appName') || 'JupyterLite';

  app.registerPluginModules(pluginsToRegister);

  // Expose global app instance when in dev mode or when toggled explicitly.
  const exposeAppInBrowser =
    (PageConfig.getOption('exposeAppInBrowser') || '').toLowerCase() === 'true';

  if (exposeAppInBrowser) {
    window.jupyterapp = app;
  }

  /* eslint-disable no-console */
  await app.start();
  await app.restored;
}