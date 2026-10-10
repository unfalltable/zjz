import 'dart:math';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../data/models.dart';
import '../l10n/strings.dart';
import '../state/store_model.dart';
import 'store_scope.dart';

class StoreShell extends StatelessWidget {
  const StoreShell({super.key, required this.child, required this.path});
  final Widget child;
  final String path;
  @override
  Widget build(BuildContext context) {
    final model = StoreScope.of(context), copy = Copy(model.locale);
    final paths = ['/', '/saved', '/bag', '/track'];
    final index = max(0, paths.indexOf(path));
    final labels = [
      copy.t('shop'),
      copy.t('saved'),
      '${copy.t('bag')} (${model.count})',
      copy.t('track'),
    ];
    const icons = [
      Icons.storefront_outlined,
      Icons.favorite_border,
      Icons.shopping_bag_outlined,
      Icons.local_shipping_outlined,
    ];
    final wide = MediaQuery.sizeOf(context).width >= 800;
    void navigate(int index) {
      ScaffoldMessenger.of(context).removeCurrentSnackBar();
      context.go(paths[index]);
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'MIOVA 妙物',
          style: TextStyle(fontWeight: FontWeight.w900),
        ),
        actions: [
          PopupMenuButton<String>(
            tooltip: copy.t('language'),
            icon: const Icon(Icons.language),
            onSelected: model.setLocale,
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'en', child: Text('English')),
              PopupMenuItem(value: 'zh', child: Text('中文')),
              PopupMenuItem(value: 'es', child: Text('Español')),
            ],
          ),
        ],
      ),
      body: SafeArea(
        top: false,
        child: Row(
          children: [
            if (wide)
              NavigationRail(
                selectedIndex: index,
                labelType: NavigationRailLabelType.all,
                onDestinationSelected: navigate,
                destinations: List.generate(
                  4,
                  (i) => NavigationRailDestination(
                    icon: Icon(icons[i]),
                    label: Text(labels[i]),
                  ),
                ),
              ),
            Expanded(
              child: Align(
                alignment: Alignment.topCenter,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 1184),
                  child: child,
                ),
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: wide
          ? null
          : NavigationBar(
              selectedIndex: index,
              onDestinationSelected: navigate,
              destinations: List.generate(
                4,
                (i) => NavigationDestination(
                  icon: Icon(icons[i]),
                  label: labels[i],
                ),
              ),
            ),
    );
  }
}

class ShopScreen extends StatefulWidget {
  const ShopScreen({super.key, this.savedOnly = false});
  final bool savedOnly;
  @override
  State<ShopScreen> createState() => _ShopScreenState();
}

class _ShopScreenState extends State<ShopScreen> {
  String query = '', category = 'all';
  @override
  Widget build(BuildContext context) {
    final model = StoreScope.of(context), copy = Copy(model.locale);
    if (model.loading && model.catalog == null) {
      return CatalogLoading(copy: copy);
    }
    if (model.catalog == null) {
      return CatalogUnavailable(copy: copy, retry: model.reload);
    }
    final items = model.catalog!.products
        .where(
          (product) =>
              (!widget.savedOnly || model.favorites.contains(product.id)) &&
              (category == 'all' || product.category == category) &&
              '${product.name} ${product.text(product.description, model.locale)}'
                  .toLowerCase()
                  .contains(query.toLowerCase()),
        )
        .toList();
    return RefreshIndicator(
      onRefresh: model.reload,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (model.loading) ...[
            LinearProgressIndicator(semanticsLabel: copy.t('loadingCatalog')),
            const SizedBox(height: 16),
          ],
          if (model.error != null) ...[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Semantics(
                      liveRegion: true,
                      child: Text(copy.t('unavailableBody')),
                    ),
                    const SizedBox(height: 16),
                    OutlinedButton(
                      onPressed: model.reload,
                      child: Text(copy.t('retry')),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],
          if (!widget.savedOnly) ...[
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                copy.t('heading'),
                style: Theme.of(context).textTheme.headlineMedium
                    ?.copyWith(fontWeight: FontWeight.w800),
              ),
            ),
            Text(copy.t('curated')),
            const SizedBox(height: 24),
            DropdownButtonFormField<String>(
              initialValue: model.destination,
              decoration: InputDecoration(labelText: copy.t('country')),
              items: model.catalog!.destinations.entries
                  .map(
                    (entry) => DropdownMenuItem(
                      value: entry.key,
                      child: Text(entry.value[model.locale] ?? entry.key),
                    ),
                  )
                  .toList(),
              onChanged: (value) {
                if (value != null) model.setDestination(value);
              },
            ),
            const SizedBox(height: 16),
          ] else
            Text(
              copy.t('saved'),
              style: Theme.of(context).textTheme.headlineMedium,
            ),
          TextField(
            decoration: InputDecoration(
              labelText: copy.t('search'),
              prefixIcon: const Icon(Icons.search),
            ),
            onChanged: (value) => setState(() => query = value),
          ),
          const SizedBox(height: 16),
          if (!widget.savedOnly)
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: ['all', 'home', 'tech', 'wear']
                  .map(
                    (value) => ChoiceChip(
                      label: Text(copy.t(value)),
                      selected: category == value,
                      onSelected: (_) => setState(() => category = value),
                    ),
                  )
                  .toList(),
            ),
          const SizedBox(height: 16),
          if (model.catalog!.products.isEmpty && !widget.savedOnly)
            CatalogEmpty(copy: copy, retry: model.reload)
          else if (items.isEmpty)
            EmptyFinds(copy: copy)
          else
            LayoutBuilder(
              builder: (context, constraints) {
                final columns = MediaQuery.textScalerOf(context).scale(16) > 22
                    ? 1
                    : max(1, (constraints.maxWidth / 160).floor());
                final width =
                    (constraints.maxWidth - 16 * (columns - 1)) / columns;
                return Wrap(
                  spacing: 16,
                  runSpacing: 16,
                  children: items
                      .map(
                        (product) => SizedBox(
                          width: width,
                          child: ProductCard(product: product),
                        ),
                      )
                      .toList(),
                );
              },
            ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

class ProductCard extends StatelessWidget {
  const ProductCard({super.key, required this.product});
  final Product product;
  @override
  Widget build(BuildContext context) {
    final model = StoreScope.of(context), copy = Copy(model.locale);
    final saved = model.favorites.contains(product.id);
    return Card(
      clipBehavior: Clip.antiAlias,
      margin: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: () => context.push('/product/${product.id}'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                AspectRatio(
                  aspectRatio: 1.2,
                  child: ProductImage(product: product, model: model),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 16, 12, 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        product.text(product.badge, model.locale),
                        style: Theme.of(context).textTheme.labelLarge,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        product.name,
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        money(product.priceCents),
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(8),
            child: Row(
              children: [
                Expanded(
                  child: FilledButton(
                    onPressed:
                        model.loading ||
                            model.error != null ||
                            (model.bag[product.id] ?? 0) >=
                                min(10, product.inventory)
                        ? null
                        : () {
                            model.quantity(
                              product.id,
                              (model.bag[product.id] ?? 0) + 1,
                            );
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text(copy.t('added')),
                                duration: const Duration(seconds: 2),
                              ),
                            );
                          },
                    child: Text(copy.t(product.inventory > 0 ? 'add' : 'sold')),
                  ),
                ),
                IconButton(
                  tooltip: copy.t(saved ? 'unsave' : 'save'),
                  isSelected: saved,
                  icon: const Icon(Icons.favorite_border),
                  selectedIcon: const Icon(Icons.favorite),
                  onPressed: () => model.toggleFavorite(product.id),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class ProductImage extends StatelessWidget {
  const ProductImage({super.key, required this.product, required this.model});
  final Product product;
  final StoreModel model;
  @override
  Widget build(BuildContext context) => Image.network(
    model.api.uri(product.image).toString(),
    fit: BoxFit.cover,
    semanticLabel: product.name,
    loadingBuilder: (context, child, progress) => progress == null
        ? child
        : ColoredBox(
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            child: const Center(child: CircularProgressIndicator()),
          ),
    errorBuilder: (_, _, _) => ColoredBox(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: const Center(child: Icon(Icons.image_outlined, size: 40)),
    ),
  );
}

class ProductScreen extends StatelessWidget {
  const ProductScreen({super.key, required this.id});
  final String id;
  @override
  Widget build(BuildContext context) {
    final model = StoreScope.of(context),
        copy = Copy(model.locale),
        product = model.product(id);
    return Scaffold(
      appBar: AppBar(
        title: Text(product?.name ?? 'MIOVA'),
        leading: IconButton(
          tooltip: copy.t('back'),
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/'),
        ),
      ),
      body: SafeArea(
        child: model.loading
            ? CatalogLoading(copy: copy)
            : model.error != null || model.catalog == null
            ? CatalogUnavailable(copy: copy, retry: model.reload)
            : product == null
            ? SingleChildScrollView(
                child: EmptyFinds(copy: copy, messageKey: 'productUnavailable'),
              )
            : ListView(
                padding: const EdgeInsets.all(24),
                children: [
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxHeight: 400),
                    child: ProductImage(product: product, model: model),
                  ),
                  const SizedBox(height: 24),
                  Text(
                    product.name,
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    money(product.priceCents),
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: 16),
                  Text(product.text(product.detail, model.locale)),
                  const SizedBox(height: 32),
                  FilledButton(
                    onPressed:
                        (model.bag[id] ?? 0) >= min(10, product.inventory)
                        ? null
                        : () {
                            model.quantity(id, (model.bag[id] ?? 0) + 1);
                            context.go('/bag');
                          },
                    child: Text(copy.t(product.inventory > 0 ? 'add' : 'sold')),
                  ),
                ],
              ),
      ),
    );
  }
}

class EmptyFinds extends StatelessWidget {
  const EmptyFinds({super.key, required this.copy, this.messageKey = 'empty'});
  final Copy copy;
  final String messageKey;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(32),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.shopping_bag_outlined, size: 48),
        const SizedBox(height: 24),
        Text(
          copy.t(messageKey),
          style: Theme.of(context).textTheme.titleLarge,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 24),
        OutlinedButton(
          onPressed: () => context.go('/'),
          child: Text(copy.t('browse')),
        ),
      ],
    ),
  );
}

class CatalogLoading extends StatelessWidget {
  const CatalogLoading({super.key, required this.copy});
  final Copy copy;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Semantics(
        liveRegion: true,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const ExcludeSemantics(child: CircularProgressIndicator()),
            const SizedBox(height: 24),
            Text(copy.t('loadingCatalog'), textAlign: TextAlign.center),
          ],
        ),
      ),
    ),
  );
}

class CatalogUnavailable extends StatelessWidget {
  const CatalogUnavailable({
    super.key,
    required this.copy,
    required this.retry,
  });
  final Copy copy;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => Center(
    child: SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Semantics(
            liveRegion: true,
            child: Text(
              copy.t('unavailable'),
              style: Theme.of(context).textTheme.headlineSmall,
              textAlign: TextAlign.center,
            ),
          ),
          const SizedBox(height: 16),
          Text(copy.t('unavailableBody'), textAlign: TextAlign.center),
          const SizedBox(height: 24),
          FilledButton(onPressed: retry, child: Text(copy.t('retry'))),
        ],
      ),
    ),
  );
}

class CatalogEmpty extends StatelessWidget {
  const CatalogEmpty({super.key, required this.copy, required this.retry});
  final Copy copy;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 32),
    child: Column(
      children: [
        Text(
          copy.t('catalogEmpty'),
          style: Theme.of(context).textTheme.titleLarge,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 16),
        Text(copy.t('catalogEmptyBody'), textAlign: TextAlign.center),
        const SizedBox(height: 24),
        OutlinedButton(onPressed: retry, child: Text(copy.t('retry'))),
      ],
    ),
  );
}

class BagScreen extends StatelessWidget {
  const BagScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final model = StoreScope.of(context), copy = Copy(model.locale);
    if (model.loading) return CatalogLoading(copy: copy);
    if (model.catalog == null || model.error != null) {
      return CatalogUnavailable(copy: copy, retry: model.reload);
    }
    if (model.count == 0) {
      return SingleChildScrollView(child: EmptyFinds(copy: copy));
    }
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text(copy.t('bag'), style: Theme.of(context).textTheme.headlineMedium),
        const SizedBox(height: 24),
        ...model.bag.entries.map((entry) {
          final product = model.product(entry.key)!;
          return Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    product.name,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(money(product.priceCents * entry.value)),
                  Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: 8,
                    children: [
                      IconButton(
                        tooltip: copy.t('decrease'),
                        icon: const Icon(Icons.remove),
                        onPressed: () =>
                            model.quantity(product.id, entry.value - 1),
                      ),
                      Semantics(
                        label: '${entry.value}',
                        child: Text('${entry.value}'),
                      ),
                      IconButton(
                        tooltip: copy.t('increase'),
                        icon: const Icon(Icons.add),
                        onPressed: entry.value >= min(10, product.inventory)
                            ? null
                            : () => model.quantity(product.id, entry.value + 1),
                      ),
                      IconButton(
                        tooltip: copy.t('remove'),
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () => model.quantity(product.id, 0),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        }),
        const SizedBox(height: 24),
        Text(
          '${copy.t('subtotal')}: ${money(model.subtotal)}',
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 24),
        FilledButton(
          onPressed: () => context.push('/checkout'),
          child: Text(copy.t('checkout')),
        ),
      ],
    );
  }
}
