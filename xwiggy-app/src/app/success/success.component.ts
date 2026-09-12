import { Component, OnInit } from '@angular/core';
import {Router} from "@angular/router";
import {HttpClient} from "@angular/common/http";
import {environment} from "../../environments/environment";
import {Order} from "../merchant-orders/merchant-orders.component";

@Component({
  standalone: false,
  selector: 'app-success',
  templateUrl: './success.component.html',
  styleUrls: ['./success.component.css']
})
export class SuccessComponent implements OnInit {

  order:Order=null;
  loading:boolean=true;

  constructor(private router:Router, private http:HttpClient) { }

  ngOnInit() {
    if (sessionStorage.getItem("userData") == null) {
      this.router.navigate(['login']);
      return;
    }
    const orderId = sessionStorage.getItem("orderId");
    if (orderId == null) {
      this.router.navigate(["menu"]);
      return;
    }

    // Show the order's real, current status rather than a hardcoded "accepted" message -
    // it was just paid, but a merchant could in principle act on it within that instant.
    this.loading = true;
    this.http.get<Order>(`${environment.apiUrl}/orders/${orderId}`).subscribe({
      next: (order) => {
        this.loading = false;
        this.order = order;
      },
      error: () => {
        this.loading = false;
      }
    });
  }

  get itemCount():number{
    return this.order ? this.order.items.reduce((sum, i) => sum + i.quantity, 0) : 0;
  }

  clearLocal(){
    sessionStorage.clear();
  }

}
