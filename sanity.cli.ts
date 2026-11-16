import {defineCliConfig} from 'sanity/cli'

export default defineCliConfig({
  app: {
    // Required by `sanity dev` ("Apps require an organization ID"). `sanity build`
    // does not need it. Find it in sanity.io/manage, or with `sanity organizations list`.
    organizationId: process.env.SANITY_APP_ORGANIZATION_ID,
    entry: './src/App.tsx',
  },
})
