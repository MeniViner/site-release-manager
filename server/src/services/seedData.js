export function buildSeedFiles(site) {
  const siteRoot = `/sites/${site.siteCode}`;
  const siteDbFolder = String(site.siteDbFolder || 'siteDB').trim();
  const usersDbFolder = String(site.usersDbFolder || 'siteUsersDb').trim();
  const siteAssetsFolder = String(site.siteAssetsFolder || 'siteAssets').trim();
  const widgetsDbTarget = String(site.widgetsDbTarget || 'users').trim().toLowerCase() === 'site' ? 'site' : 'users';
  const siteDbRoot = `${siteRoot}/${siteDbFolder}`;
  const usersDbRoot = `${siteRoot}/${usersDbFolder}`;
  const assetsRoot = `${siteDbRoot}/${siteAssetsFolder}`;
  const widgetsRoot = widgetsDbTarget === 'site' ? assetsRoot : usersDbRoot;
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

  return [
    { path: `${assetsRoot}/bihs_master_config_v1.txt`, content: json({ schemaVersion: '1.0.0' }) },
    { path: `${assetsRoot}/users_data.txt`, content: json([]) },
    { path: `${assetsRoot}/events_data.txt`, content: json({ displayCount: 3, displayMode: 'default', events: [] }) },
    { path: `${assetsRoot}/nav_data.txt`, content: json([]) },
    { path: `${assetsRoot}/site_content_data.txt`, content: json({}) },
    { path: `${assetsRoot}/theme_data.txt`, content: json({}) },
    { path: `${assetsRoot}/external_links_data.txt`, content: json([]) },
    {
      path: `${assetsRoot}/gantt_data.txt`,
      content: json({ enabled: false, buttonLabel: 'גאנט עבודה', pageTitle: 'גאנט עבודה', description: '', groupBy: 'category', defaultView: 'month', showLegend: true, showToday: true, categories: [], items: [] }),
    },
    { path: `${widgetsRoot}/widgets_data.txt`, content: json({}) },
  ];
}
