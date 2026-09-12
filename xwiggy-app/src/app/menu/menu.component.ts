import {Component, OnInit} from '@angular/core';
import {environment} from "../../environments/environment";
import {HttpClient} from "@angular/common/http";
import {Router} from "@angular/router";
import {MenuServiceService} from "../menu-service.service";
import {User} from "../app.component";

@Component({
  standalone: false,
  selector: 'app-menu',
  templateUrl: './menu.component.html',
  styleUrls: ['./menu.component.css']
})
export class MenuComponent implements OnInit {

  model:menu[] = [];

  loadingMenu:boolean=true;
  loadError:string=null;
  message:string=null;
  ordering:boolean=false;

  user:User=null;
  searchText:string='';
  selectedCategory:string=null;

  // Price range filter + sort/show controls, styled after a storefront product-grid layout:
  // a filter sidebar (categories with counts, a price range) next to a grid with a
  // sort-by/show-count toolbar above it.
  priceFrom:number=0;
  priceTo:number=0;
  sortBy:'default'|'priceAsc'|'priceDesc'|'nameAsc' = 'default';
  showCount:number=12;

  // Running cart, keyed by food id - purely client-side until "Checkout" actually places
  // the order. No network call happens as quantities change; the sidebar total below is
  // just derived from this state.
  cart:{[foodId:string]:number} = {};

  constructor(private http:HttpClient, private router:Router,private menuService:MenuServiceService) { }

  ngOnInit() {
    if (sessionStorage.getItem("userData") == null) {
      this.router.navigate(['login']);
      return;
    }
    this.user = JSON.parse(sessionStorage.getItem('userData'));
    this.getItems();
  }

  clearLocal(){
    sessionStorage.clear();
  }

  getItems():void{
    this.loadingMenu = true;
    this.loadError = null;
    this.menuService.getItems().subscribe({
      next: (men: menu[]) => {
        this.loadingMenu = false;
        this.model = men;
        this.cart = {};
        const prices = men.map(f => f.price);
        this.priceFrom = prices.length ? Math.min(...prices) : 0;
        this.priceTo = prices.length ? Math.max(...prices) : 0;
      },
      error: () => {
        this.loadingMenu = false;
        this.loadError = "Couldn't load the menu. Check your connection and try again.";
      }
    });
  }

  get categories():string[] {
    const seen = new Set<string>();
    for (const food of this.model) {
      if (food.category) seen.add(food.category);
    }
    return Array.from(seen);
  }

  get priceBounds():{min:number,max:number}{
    const prices = this.model.map(f => f.price);
    return { min: prices.length ? Math.min(...prices) : 0, max: prices.length ? Math.max(...prices) : 0 };
  }

  categoryCount(category:string):number{
    return this.model.filter(food => food.category === category).length;
  }

  get filteredModel():menu[] {
    const text = this.searchText.trim().toLowerCase();
    const filtered = this.model.filter(food =>
      (!this.selectedCategory || food.category === this.selectedCategory) &&
      (!text || food.item.toLowerCase().includes(text)) &&
      food.price >= this.priceFrom && food.price <= this.priceTo
    );
    switch (this.sortBy) {
      case 'priceAsc': return filtered.slice().sort((a, b) => a.price - b.price);
      case 'priceDesc': return filtered.slice().sort((a, b) => b.price - a.price);
      case 'nameAsc': return filtered.slice().sort((a, b) => a.item.localeCompare(b.item));
      default: return filtered;
    }
  }

  get visibleModel():menu[]{
    return this.filteredModel.slice(0, this.showCount);
  }

  selectCategory(category:string|null):void{
    this.selectedCategory = this.selectedCategory === category ? null : category;
  }

  // The two range inputs share the same track, so keep the "from" thumb from crossing past
  // the "to" thumb (and vice versa).
  onPriceFromChange():void{
    if (this.priceFrom > this.priceTo) this.priceFrom = this.priceTo;
  }

  onPriceToChange():void{
    if (this.priceTo < this.priceFrom) this.priceTo = this.priceFrom;
  }

  categoryIcon(category:string|null):string{
    const icons:{[key:string]:string} = {
      'Beverage': 'fa-coffee',
      'Bakery': 'fa-birthday-cake',
      'Tiffin': 'fa-cutlery',
      'Sweets': 'fa-heart',
      'Snacks': 'fa-fire',
    };
    return icons[category] || 'fa-th-large';
  }

  quantityOf(food:menu):number{
    return this.cart[food.id] || 0;
  }

  increment(food:menu):void{
    const current = this.quantityOf(food);
    if (current < food.quantity) {
      this.cart[food.id] = current + 1;
    }
  }

  decrement(food:menu):void{
    const current = this.quantityOf(food);
    if (current > 0) {
      this.cart[food.id] = current - 1;
    }
  }

  get cartLines():CartLine[]{
    return this.model
      .filter(food => this.quantityOf(food) > 0)
      .map(food => ({ food, quantity: this.quantityOf(food), lineTotal: food.price * this.quantityOf(food) }));
  }

  get cartTotal():number{
    return this.cartLines.reduce((sum, line) => sum + line.lineTotal, 0);
  }

  // Places the real order from the current cart, then hands off to the existing
  // checkout/payment page - this is the only point that talks to the backend.
  checkout():void{
    if (this.ordering) return;
    const items = this.cartLines.map(line => ({ foodId: line.food.id, quantity: line.quantity }));
    if (items.length === 0) {
      this.message = "Add at least one item to your order first";
      return;
    }
    this.message = null;
    this.ordering = true;
    let url = `${environment.apiUrl}/order`;
    this.http.post<OrderResponse>(url, { items }).subscribe(
      res => {
        this.ordering = false;
        sessionStorage.setItem('orderId', String(res.id));
        sessionStorage.setItem('total', String(res.total));
        this.router.navigate(['checkout']);
      },
      err => {
        this.ordering = false;
        this.message = typeof err.error === 'string' ? err.error : "Couldn't place the order. Please try again.";
      }
    )
  }
}

export interface menu {
  id:string;
  item:string;
  price:number;
  quantity:number;
  url:string;
  formID:string;
  cartID:string;
  category:string;
}

export interface CartLine {
  food:menu;
  quantity:number;
  lineTotal:number;
}

export interface OrderResponse {
  id:number;
  total:number;
  status:string;
}
