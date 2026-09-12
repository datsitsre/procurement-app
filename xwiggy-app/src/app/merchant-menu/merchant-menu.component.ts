import { Component, OnInit } from '@angular/core';
import {environment} from "../../environments/environment";
import {menu} from "../menu/menu.component";
import {HttpClient} from "@angular/common/http";
import {Router} from "@angular/router";
import {MenuServiceService} from "../menu-service.service";
import {User} from "../app.component";


@Component({
  standalone: false,
  selector: 'app-merchant-menu',
  templateUrl: './merchant-menu.component.html',
  styleUrls: ['./merchant-menu.component.css']
})
export class MerchantMenuComponent implements OnInit {

  model:menu[] = [];

  loadingMenu:boolean=true;
  loadError:string=null;
  message:string=null;
  success:string=null;
  updating:boolean=false;

  user:User=null;
  searchText:string='';
  selectedCategory:string=null;

  // Pending restock amounts, keyed by food id - purely client-side until "Update stock"
  // actually submits them. Mirrors the customer dashboard's running cart.
  restock:{[foodId:string]:number} = {};

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
        this.restock = {};
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

  get filteredModel():menu[] {
    const text = this.searchText.trim().toLowerCase();
    return this.model.filter(food =>
      (!this.selectedCategory || food.category === this.selectedCategory) &&
      (!text || food.item.toLowerCase().includes(text))
    );
  }

  selectCategory(category:string|null):void{
    this.selectedCategory = this.selectedCategory === category ? null : category;
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

  amountToAdd(food:menu):number{
    return this.restock[food.id] || 0;
  }

  increment(food:menu):void{
    this.restock[food.id] = this.amountToAdd(food) + 1;
  }

  decrement(food:menu):void{
    const current = this.amountToAdd(food);
    if (current > 0) {
      this.restock[food.id] = current - 1;
    }
  }

  get restockLines():RestockLine[]{
    return this.model
      .filter(food => this.amountToAdd(food) > 0)
      .map(food => ({ food, amount: this.amountToAdd(food) }));
  }

  updateStock():void{
    if (this.updating) return;
    this.message = null;
    this.success = null;

    const items = this.restockLines.map(line => ({ foodId: line.food.id, quantity: line.amount }));
    if (items.length === 0) {
      this.message = "Add a quantity for at least one item first";
      return;
    }

    this.updating = true;
    let url = `${environment.apiUrl}/addToCart`;
    this.http.post<menu[]>(url, items).subscribe(
      res=>{
        this.updating = false;
        this.success = "Stock updated";
        this.getItems();
      },
      err=>{
        this.updating = false;
        this.message = typeof err.error === 'string' ? err.error : "Couldn't update stock. Please try again.";
      }
    )
  }
}

export interface RestockLine {
  food:menu;
  amount:number;
}
