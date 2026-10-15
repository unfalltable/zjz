import 'package:flutter_test/flutter_test.dart';
import 'package:miova_app/data/models.dart';

Product item(String id, int cents, int inventory, {List<Product> variants = const []}) =>
    Product(
      id: id,
      name: 'Example',
      priceCents: cents,
      category: 'tech',
      image: '/products/nova.webp',
      inventory: inventory,
      description: const {'en': 'Example'},
      detail: const {'en': 'Example'},
      badge: const {'en': ''},
      variants: variants,
    );

void main() {
  test('Money renders cents rather than a literal interpolation expression', () {
    expect(money(0), r'US$0.00');
    expect(money(1), r'US$0.01');
    expect(money(12900), r'US$129.00');
  });

  test('Listing starting price uses available variants while any remain', () {
    final listing = item('root', 100, 0, variants: [
      item('root', 100, 0),
      item('red', 2500, 2),
      item('blue', 2000, 1),
    ]);
    expect(listing.listingPriceCents, 2000);
    expect(listing.listingInventory, 3);
  });

  test('Sold out and plain listings retain their real catalogue prices', () {
    expect(item('root', 2500, 0, variants: [
      item('root', 2500, 0),
      item('red', 3000, 0),
    ]).listingPriceCents, 2500);
    expect(item('plain', 1000, 1).listingPriceCents, 1000);
  });
}
